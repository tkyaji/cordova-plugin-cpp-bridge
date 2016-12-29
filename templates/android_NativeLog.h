#ifndef NATIVELOG_H
#define NATIVELOG_H

#include <android/log.h>

void _log(const char *format, ...) {
    va_list args;
    va_start (args, format);
    __android_log_vprint(ANDROID_LOG_DEBUG, "CDVCppBridge", format, args);
    va_end(args);
}

#endif //NATIVELOG_H
