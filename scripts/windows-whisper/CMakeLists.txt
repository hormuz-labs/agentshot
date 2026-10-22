cmake_minimum_required(VERSION 3.20)
project(manul_whisper LANGUAGES C CXX)

if(NOT WIN32 OR NOT MSVC OR NOT MANUL_WHISPER_SOURCE)
  message(FATAL_ERROR "Native Windows MSVC and MANUL_WHISPER_SOURCE are required")
endif()

# Keep the pinned upstream checkout unchanged. CMake merges this manifest into PE resource #1.
add_subdirectory("${MANUL_WHISPER_SOURCE}" upstream)
target_sources(whisper-cli PRIVATE "${CMAKE_CURRENT_LIST_DIR}/whisper-cli.manifest")
