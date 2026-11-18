cmake_minimum_required(VERSION 3.22)

project(box3d_webgpu_wasm VERSION 1.0.2 LANGUAGES C)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This target must be configured through emcmake / the Emscripten toolchain.")
endif()

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION ON)

if(NOT DEFINED BOX3D_ROOT)
  get_filename_component(BOX3D_ROOT "${CMAKE_CURRENT_LIST_DIR}/../third_party/box3d" ABSOLUTE)
endif()
if(NOT EXISTS "${BOX3D_ROOT}/CMakeLists.txt")
  message(FATAL_ERROR "Box3D source not found at ${BOX3D_ROOT}")
endif()

if(NOT DEFINED BOX3D_OUTPUT_DIR)
  get_filename_component(BOX3D_OUTPUT_DIR "${CMAKE_CURRENT_LIST_DIR}/../public/box3d" ABSOLUTE)
endif()
file(MAKE_DIRECTORY "${BOX3D_OUTPUT_DIR}")

# Box3D is deliberately a subproject here. This prevents the upstream top-level
# Emscripten pthread policy from becoming mandatory for the browser bridge.
set(BOX3D_SAMPLES OFF CACHE BOOL "" FORCE)
set(BOX3D_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(BOX3D_DOCS OFF CACHE BOOL "" FORCE)
set(BOX3D_PROFILE OFF CACHE BOOL "" FORCE)
set(BOX3D_VALIDATE OFF CACHE BOOL "" FORCE)
set(BOX3D_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(BOX3D_BUILD_SHADERS OFF CACHE BOOL "" FORCE)
set(BOX3D_DOUBLE_PRECISION OFF CACHE BOOL "" FORCE)

# WebAssembly SIMD is enabled by default. Override with
# -DBOX3D_DISABLE_SIMD=ON only for diagnostics/compatibility testing.
if(NOT DEFINED BOX3D_DISABLE_SIMD)
  set(BOX3D_DISABLE_SIMD OFF CACHE BOOL "" FORCE)
endif()

# Optional threaded artifact (box3d-mt.{js,wasm}). OFF keeps the default build
# byte-identical to the single-threaded artifact. Shared memory only links when
# every object, upstream library included, is compiled with -pthread, so the
# flag is applied before the subproject is added. Browsers additionally need a
# cross-origin-isolated page to instantiate shared memory (see
# docs/THREADED_ENGINE.md); the loader falls back to the single-threaded module.
option(B3W_THREADS "Build the pthread-enabled artifact box3d-mt" OFF)
# Adds Node.js to the Emscripten environment list so test harnesses can load the
# artifact. Leave OFF for anything that ships to browsers.
option(B3W_NODE_ENV "Also target Node.js (test artifacts only)" OFF)
if(B3W_THREADS)
  string(APPEND CMAKE_C_FLAGS " -pthread")
endif()

add_subdirectory("${BOX3D_ROOT}" "${CMAKE_BINARY_DIR}/box3d-upstream" EXCLUDE_FROM_ALL)

add_executable(box3d_web box3d_web.c)
target_link_libraries(box3d_web PRIVATE box3d::box3d)
target_include_directories(box3d_web PRIVATE "${BOX3D_ROOT}/include")
target_compile_options(box3d_web PRIVATE -O3 -flto)

if(NOT BOX3D_DISABLE_SIMD)
  target_compile_options(box3d_web PRIVATE -msimd128)
  target_link_options(box3d_web PRIVATE -msimd128)
endif()

set(B3W_EXPORTED_FUNCTIONS
  "['_malloc','_free','_b3w_max_bodies','_b3w_spawn_rain','_b3w_create_scene','_b3w_create_demo','_b3w_destroy','_b3w_body_count','_b3w_dynamic_count','_b3w_matrices_ptr','_b3w_colors_ptr','_b3w_transform_version','_b3w_color_version','_b3w_awake_count','_b3w_sync_transforms','_b3w_step','_b3w_apply_impulse','_b3w_kick_stack','_b3w_explode','_b3w_launch_projectile','_b3w_replay_hash','_b3w_world_create','_b3w_world_destroy','_b3w_world_valid','_b3w_world_api_version','_b3w_world_capacity','_b3w_world_last_create_error','_b3w_world_max_bodies','_b3w_world_spawn_rain','_b3w_world_create_scene','_b3w_world_create_demo','_b3w_world_clear','_b3w_world_body_count','_b3w_world_dynamic_count','_b3w_world_matrices_ptr','_b3w_world_colors_ptr','_b3w_world_transform_version','_b3w_world_color_version','_b3w_world_awake_count','_b3w_world_sync_transforms','_b3w_world_step','_b3w_world_apply_impulse','_b3w_world_kick_stack','_b3w_world_explode','_b3w_world_launch_projectile','_b3w_world_replay_hash','_b3w_world_reserve','_b3w_world_buffer_version','_b3w_world_storage_bytes','_b3w_world_contact_count','_b3w_world_body_handle','_b3w_world_body_index','_b3w_world_destroy_body','_b3w_world_apply_body_impulse','_b3w_world_launch_projectile_handle']"
)

option(B3W_CAPACITY_TESTING "Enable allocation-failure injection in a test-only artifact" OFF)
string(REPLACE "]" ",'_b3w_world_query_reserve','_b3w_world_query_inputs_ptr','_b3w_world_query_status_ptr','_b3w_world_query_hits_ptr','_b3w_world_query_version','_b3w_world_query_storage_bytes','_b3w_world_query_batch']" B3W_EXPORTED_FUNCTIONS "${B3W_EXPORTED_FUNCTIONS}")

option(B3W_QUERY_TESTING "Enable query allocation/version fault injection in a test-only artifact" OFF)
if(B3W_QUERY_TESTING)
  target_compile_definitions(box3d_web PRIVATE B3W_QUERY_TESTING=1)
  string(REPLACE "]" ",'_b3w_test_fail_next_query_allocation','_b3w_test_exhaust_query_version']" B3W_EXPORTED_FUNCTIONS "${B3W_EXPORTED_FUNCTIONS}")
endif()

if(B3W_CAPACITY_TESTING)
  target_compile_definitions(box3d_web PRIVATE B3W_CAPACITY_TESTING=1)
  string(REPLACE "]" ",'_b3w_test_fail_next_capacity_allocation']" B3W_EXPORTED_FUNCTIONS "${B3W_EXPORTED_FUNCTIONS}")
endif()

option(B3W_RECYCLING_TESTING "Enable generation-exhaustion injection in a test-only artifact" OFF)
if(B3W_RECYCLING_TESTING)
  target_compile_definitions(box3d_web PRIVATE B3W_RECYCLING_TESTING=1)
  string(REPLACE "]" ",'_b3w_test_exhaust_body_generation']" B3W_EXPORTED_FUNCTIONS "${B3W_EXPORTED_FUNCTIONS}")
endif()

set(B3W_ENVIRONMENT "web,worker")
# The threaded artifact always carries the Node code path (never taken in a
# browser) so the repository tests run the exact bytes that ship.
if(B3W_NODE_ENV OR B3W_THREADS)
  string(APPEND B3W_ENVIRONMENT ",node")
endif()
set(B3W_RUNTIME_METHODS "['HEAPF32','HEAPU8','ccall','cwrap']")
set(B3W_OUTPUT_NAME "box3d")
if(B3W_THREADS)
  set(B3W_OUTPUT_NAME "box3d-mt")
  # box3d_web.c is compiled unchanged; only its calls to b3CreateWorld and
  # b3World_Step are renamed so they land in the wrappers of box3d_threads.c.
  # The definitions are per-source, so box3d_threads.c still sees the upstream
  # functions it wraps.
  target_sources(box3d_web PRIVATE box3d_threads.c)
  set_source_files_properties(box3d_web.c PROPERTIES COMPILE_DEFINITIONS
    "b3CreateWorld=b3w_threads_create_world;b3World_Step=b3w_threads_step")
  target_compile_options(box3d_web PRIVATE -pthread)
  string(REPLACE "]" ",'_b3w_threads_supported','_b3w_worker_capacity','_b3w_get_worker_count','_b3w_set_worker_count','_b3w_last_step_workers','_b3w_get_thread_threshold','_b3w_set_thread_threshold']" B3W_EXPORTED_FUNCTIONS "${B3W_EXPORTED_FUNCTIONS}")
  # Worker threads can grow the shared memory, which leaves the main thread's
  # Module.HEAP* views stale; wasmMemory.buffer is always current.
  set(B3W_RUNTIME_METHODS "['HEAPF32','HEAPU8','ccall','cwrap','wasmMemory']")
  # The loader passes Module.b3wPoolSize (workers to preload, clamped to the
  # hardware). Preloaded workers make pthread_create synchronous and let
  # createModule() resolve only once they are ready. STRICT=2 turns pool
  # exhaustion into an EAGAIN instead of an asynchronous worker start.
  target_link_options(box3d_web PRIVATE
    -pthread
    "-sPTHREAD_POOL_SIZE=(Module['b3wPoolSize']|0)"
    "-sPTHREAD_POOL_SIZE_STRICT=2"
  )
endif()

# The generated ES module exports an async default factory consumed by
# src/physics/wasm.ts. No main() is needed for this library-style module.
target_link_options(box3d_web PRIVATE
  --no-entry
  -O3
  -flto
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sENVIRONMENT=${B3W_ENVIRONMENT}"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sABORTING_MALLOC=0"
  "-sWASM_BIGINT=1"
  "-sFILESYSTEM=0"
  "-sASSERTIONS=0"
  "-sEXPORTED_FUNCTIONS=${B3W_EXPORTED_FUNCTIONS}"
  "-sEXPORTED_RUNTIME_METHODS=${B3W_RUNTIME_METHODS}"
)

set_target_properties(box3d_web PROPERTIES
  OUTPUT_NAME "${B3W_OUTPUT_NAME}"
  SUFFIX ".js"
  RUNTIME_OUTPUT_DIRECTORY "${BOX3D_OUTPUT_DIR}"
)
