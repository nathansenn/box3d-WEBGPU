// Box3D WebGPU AAA Physics Lab bridge: worker-thread layer.
// Linked into the pthread artifact (box3d-mt.{js,wasm}) only; see docs/THREADED_ENGINE.md.
//
// box3d_web.c stays byte-identical to the single-threaded build. The CMake target
// renames the two upstream calls that decide how a world is built and stepped
// (b3CreateWorld, b3World_Step) to the wrappers below for that one source file, so
// the bridge needs no #ifdef and this file still sees the real upstream functions.
//
// Upstream's built-in scheduler creates its worker threads inside b3CreateWorld and
// joins them in b3DestroyWorld, and the bridge recreates its world on every scene
// switch. An Emscripten Worker returns to its pool only after the main thread
// reaches the JS event loop, so one scheduler per world would exhaust the pool
// within a frame. ONE scheduler therefore lives for the whole module and every world
// uses it through upstream's external task callbacks. Worlds are stepped one at a
// time on the calling thread, so one task queue is enough.
//
// Determinism: Box3D produces bit-identical results for any worker count, so the
// count is a pure performance knob (checked by scripts/threaded-determinism-test.mjs).

#include <box3d/box3d.h>

#include <stddef.h>

#ifdef BOX3D_DOUBLE_PRECISION
// box3d.h renames b3CreateWorld in that configuration, which would bypass the wrapper.
#error "box3d_threads.c does not support BOX3D_DOUBLE_PRECISION"
#endif

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define B3W_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define B3W_EXPORT
#endif

// Upstream's scheduler is internal (src/scheduler.h). Its prototypes are repeated
// here; the coupling is pinned to Box3D v0.1.0 by third_party/box3d and by the
// determinism test, which fails loudly if a scheduler change breaks it.
typedef struct b3Scheduler b3Scheduler;
b3Scheduler* b3CreateScheduler(int workerCount);
void b3ResetScheduler(b3Scheduler* scheduler);
void* b3SchedulerEnqueueTask(b3TaskCallback* task, void* taskContext, void* userContext, const char* name);
void b3SchedulerFinishTask(void* userTask, void* userContext);

#ifdef __EMSCRIPTEN__
EM_JS_DEPS(b3w_pool, "$PThread");
// Workers preloaded by -sPTHREAD_POOL_SIZE (the loader sets Module.b3wPoolSize).
EM_JS(int, b3w_js_pool_workers, (void), { return PThread.unusedWorkers.length + PThread.runningWorkers.length; });
#else
// Native builds (syntax and logic checks only) have no preloaded pool to count.
#ifndef B3W_NATIVE_POOL_WORKERS
#define B3W_NATIVE_POOL_WORKERS 15
#endif
static int b3w_js_pool_workers(void)
{
    return B3W_NATIVE_POOL_WORKERS;
}
#endif

// A world with fewer awake bodies than this steps on the calling thread alone:
// waking the pool costs more than the work it splits (measured with 8 workers:
// 0.74-0.78x at 256 awake bodies, 1.2-1.3x at 512, 2.2x at 1024, 3.5x at 2048).
// A threaded world keeps its workers until it falls under two thirds of the
// threshold, so a body count hovering at the line does not rebuild the per-worker
// contexts every frame. Results are identical either way.
#define B3W_THREAD_MIN_AWAKE_DEFAULT 384

static b3Scheduler* g_b3wScheduler = NULL;
static int g_b3wSchedulerWorkers = 1; // workers in the scheduler, including the calling thread
static int g_b3wRequestedWorkers = 1; // worker count asked for through b3w_set_worker_count
static int g_b3wStepWorkers = 1;      // worker count of the world being stepped, read by the task callbacks
static int g_b3wLastStepWorkers = 1;  // what b3w_last_step_workers reports
static int g_b3wThreadThreshold = B3W_THREAD_MIN_AWAKE_DEFAULT;

static void* b3w_enqueue_task(b3TaskCallback* task, void* taskContext, void* userContext, const char* name)
{
    (void)userContext;
    if (g_b3wScheduler == NULL || g_b3wStepWorkers <= 1)
    {
        // Single worker: identical to upstream's serial fallback.
        task(taskContext);
        return NULL;
    }
    return b3SchedulerEnqueueTask(task, taskContext, g_b3wScheduler, name);
}

static void b3w_finish_task(void* userTask, void* userContext)
{
    (void)userContext;
    if (userTask != NULL)
    {
        b3SchedulerFinishTask(userTask, g_b3wScheduler);
    }
}

// Workers for the next step of a world that currently has `current`. More than
// one worker requires the shared scheduler: the solver's barriers deadlock if
// worker tasks run one after another on a single thread.
static int b3w_choose_workers(int current, int awake)
{
    const int requested = g_b3wRequestedWorkers;
    if (requested <= 1 || g_b3wScheduler == NULL)
    {
        return 1;
    }
    const int enter = g_b3wThreadThreshold;
    const int leave = enter - enter / 3;
    if (current <= 1)
    {
        return awake >= enter ? requested : 1;
    }
    return awake < leave ? 1 : requested;
}

// Threads the scheduler may use, including the calling thread. It never
// exceeds the preloaded pool: an unstarted thread cannot be joined later.
static int b3w_capacity_workers(void)
{
    if (g_b3wScheduler != NULL)
    {
        return g_b3wSchedulerWorkers;
    }
    const int capacity = b3w_js_pool_workers() + 1;
    return capacity < 1 ? 1 : capacity > B3_MAX_WORKERS ? B3_MAX_WORKERS : capacity;
}

// Stands in for b3CreateWorld in box3d_web.c. Starts on one worker; b3w_threads_step
// widens the world once enough bodies are awake.
b3WorldId b3w_threads_create_world(const b3WorldDef* def)
{
    if (def == NULL)
    {
        return b3_nullWorldId;
    }
    b3WorldDef patched = *def;
    patched.workerCount = 1;
    patched.enqueueTask = b3w_enqueue_task;
    patched.finishTask = b3w_finish_task;
    patched.userTaskContext = NULL;
    return b3CreateWorld(&patched);
}

// Stands in for b3World_Step in box3d_web.c. The bridge skips all-asleep worlds
// before calling it, so a step that reaches here has bodies to solve.
void b3w_threads_step(b3WorldId worldId, float timeStep, int subStepCount)
{
    const int current = b3World_GetWorkerCount(worldId);
    if (current > 0)
    {
        const int workers = b3w_choose_workers(current, b3World_GetAwakeBodyCount(worldId));
        if (workers != current)
        {
            b3World_SetWorkerCount(worldId, workers);
        }
        // Read back what upstream applied so the task callbacks can never run
        // a multi-worker world on the calling thread alone.
        g_b3wStepWorkers = b3World_GetWorkerCount(worldId);
        g_b3wLastStepWorkers = g_b3wStepWorkers;
        // With external task callbacks upstream does not own the scheduler, so the
        // per-step task slots are recycled here.
        if (g_b3wStepWorkers > 1)
        {
            b3ResetScheduler(g_b3wScheduler);
        }
    }
    b3World_Step(worldId, timeStep, subStepCount);
}

// Additive threading ABI, present only in the threaded artifact. A loader
// treats a missing _b3w_set_worker_count as "single-threaded module".
B3W_EXPORT int b3w_threads_supported(void)
{
    return 1;
}

B3W_EXPORT int b3w_worker_capacity(void)
{
    return b3w_capacity_workers();
}

// The count asked for; a world below the awake-body threshold still uses one.
B3W_EXPORT int b3w_get_worker_count(void)
{
    return g_b3wRequestedWorkers;
}

// Worker count used by the most recent step that reached the solver: 1 while
// below the threshold. A step with every body asleep never reaches it.
B3W_EXPORT int b3w_last_step_workers(void)
{
    return g_b3wLastStepWorkers;
}

// Asks for `workers` threads (calling thread included) and returns the count
// accepted, clamped to [1, capacity]. Each world switches at the start of its
// next step. Results do not depend on the count; only the time to compute them does.
B3W_EXPORT int b3w_set_worker_count(int workers)
{
    const int capacity = b3w_capacity_workers();
    workers = workers < 1 ? 1 : workers > capacity ? capacity : workers;
    if (workers > 1 && g_b3wScheduler == NULL)
    {
        g_b3wScheduler = b3CreateScheduler(capacity);
        g_b3wSchedulerWorkers = capacity;
    }
    g_b3wRequestedWorkers = workers;
    return workers;
}

// Awake-body count at which a world starts using its workers; 0 always threads.
B3W_EXPORT int b3w_get_thread_threshold(void)
{
    return g_b3wThreadThreshold;
}

B3W_EXPORT int b3w_set_thread_threshold(int awakeBodies)
{
    g_b3wThreadThreshold = awakeBodies < 0 ? 0 : awakeBodies;
    return g_b3wThreadThreshold;
}
