#import "NativeLog.h"
#import <Foundation/Foundation.h>

@interface NativeLog : NSObject

+ (void)log:(const char *)format args:(va_list)args;

@end

@implementation NativeLog

+ (void)log:(const char *)format args:(va_list)args {
    NSLogv([NSString stringWithUTF8String:format], args);
}

@end

void _log(const char *format, ...) {
    va_list args;
    va_start (args, format);
    [NativeLog log:format args:args];
    va_end(args);
}
