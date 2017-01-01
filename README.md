# cordova-plugin-cpp-bridge

This plugin makes it easy to call C++ from Javascript.


## Platform

* iOS
* Android
* OSX


## Usage

### 1. Add Plugin

```
cordova plugin add cordova-plugin-cpp-bridge
```

### 2. Add C++ Files to `cpp` directory

The cpp directory has been added to your project when adding this plugin.

**ex.**

TestCpp.h
```:
class TestCpp {
    public:
    int testMethod(int p1, const char *p2, double p3, bool p4);
    static const char* staticTestMethod();
};
```

TestCpp.cpp
```:TestCpp.cpp
#include "TestCpp.h"
#include "NativeLog.h"

int TestCpp::testMethod(int p1, const char *p2, double p3, bool p4) {
    _log("testMethod: %d, %s, %lf, %d", p1, p2, p3, p4);
    return p1 + 1;
}

const char* TestCpp::staticTestMethod() {
    return "staticTestMethod called!";
}
```


### 3. Edit `class_define.json`

Describe the interface of the class in `class_define.json`.
This file is created in the `cpp` directory.

class_define.json

```
{
    "header_files": [<header file>, ...],
    "source_files": [<source file>, ...],

    "classes": {
        "<class name>": {
            "methods": {
                "<method name>": {
                    "params": [<int / double / string / boolean>, ...],     // optional
                    "return": "<void / int / double / string / boolean>",   // optional (default:void)
                    "is_static": <true / false>                             // optional (default:false)
                }
                , ...
            }
        }
        , ...
    }
}
```


**ex.**

```
{
    "header_files": ["TestCpp.h"],
    "source_files": ["TestCpp.cpp"],

    "classes": {
        "TestCpp": {
            "methods": {
                "testMethod": {
                    "params": ["int", "string", "double", "boolean"],
                    "return": "int"
                },
                "staticTestMethod": {
                    "is_static": true,
                    "return": "string"
                }
            }
        }
    }
}
```

### 4. Call cpp method from JavaScript.

**ex.**

```
cpp.TestCpp.new(function(testCpp) {
    testCpp.testMethod(999, "message", 1.111, true, function(ret) {
        console.log('TestCpp#testMethod : ' + ret);
    });
});

cpp.TestCpp.staticTestMethod(function(ret) {
    console.log('TestCpp#staticTestMethod : ' + ret);
});
```


## 5. Build

```
cordova build ios / android
```
