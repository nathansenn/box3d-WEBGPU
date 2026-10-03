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
  "['_malloc','_free','_b3w_create_demo','_b3w_create_scene','_b3w_destroy','_b3w_body_count','_b3w_dynamic_count','_b3w_matrices_ptr','_b3w_colors_ptr','_b3w_max_bodies','_b3w_transform_version','_b3w_color_version','_b3w_awake_count','_b3w_sync_transforms','_b3w_step','_b3w_apply_impulse','_b3w_kick_stack','_b3w_explode','_b3w_launch_projectile','_b3w_spawn_rain','_b3w_replay_hash']"
)

# The generated ES module exports an async default factory consumed by
# src/physics/wasm.ts. No main() is needed for this library-style module.
target_link_options(box3d_web PRIVATE
  --no-entry
  -O3
  -flto
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sENVIRONMENT=web,worker"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sWASM_BIGINT=1"
  "-sFILESYSTEM=0"
  "-sASSERTIONS=0"
  "-sEXPORTED_FUNCTIONS=${B3W_EXPORTED_FUNCTIONS}"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPU8','ccall','cwrap']"
)

set_target_properties(box3d_web PROPERTIES
  OUTPUT_NAME "box3d"
  SUFFIX ".js"
  RUNTIME_OUTPUT_DIRECTORY "${BOX3D_OUTPUT_DIR}"
)
