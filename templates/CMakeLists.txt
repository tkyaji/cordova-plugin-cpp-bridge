cmake_minimum_required(VERSION 3.4.1)
add_library(cordova-cpp-bridge-lib SHARED /*SOURCE_FILES*/)
target_link_libraries(cordova-cpp-bridge-lib log)