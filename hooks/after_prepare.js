var pluginId = 'cordova-plugin-cpp-bridge';
var pluginName = 'CordovaCppBridge';
var bridgeFileName = 'CDVCppBridge';

module.exports = function(context) {
    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        crypto            = context.requireCordovaModule('crypto'),
        Q                 = context.requireCordovaModule('q'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util'),
        platforms         = context.requireCordovaModule('cordova-lib/src/platforms/platforms'),
        Parser            = context.requireCordovaModule('cordova-lib/src/cordova/metadata/parser'),
        ParserHelper      = context.requireCordovaModule('cordova-lib/src/cordova/metadata/parserhelper/ParserHelper'),
        ConfigParser      = context.requireCordovaModule('cordova-common').ConfigParser;

    var projectRoot = cordova_util.cdProjectRoot();

    var cppDir = path.join(projectRoot, 'cpp');

    var classDefineJson = JSON.parse(fs.readFileSync(path.join(cppDir, 'class_define.json'), 'utf-8'));
    var headerFiles = classDefineJson.header_files;
    var sourceFiles = classDefineJson.source_files;
    var classDefine = classDefineJson.classes;
    normalizeClassDefine(classDefine);
    var allClassList = Object.keys(classDefine);

    context.opts.platforms.forEach(function(platform) {
        var platformPath = path.join(projectRoot, 'platforms', platform);
        var platformApi = platforms.getPlatformApi(platform, platformPath);
        var platformInfo = platformApi.getPlatformInfo();
        var cfg = new ConfigParser(platformInfo.projectConfig.path);

        if (platform == 'ios' || platform == 'osx') {
            (new IOS_OSXManager(context, platformInfo, cppDir, classDefine, headerFiles, sourceFiles)).setup();
            (new JsManager(context, platformInfo, classDefine).setup());

        } else if (platform == 'android') {
            (new AndroidManager(context, platformInfo, cppDir, classDefine, headerFiles, sourceFiles)).setup();
            (new JsManager(context, platformInfo, classDefine).setup());
        }
    });

    function normalizeClassDefine(classDefine) {
        for (var className in classDefine) {
            var classElement = classDefine[className];

            classElement.methods = classElement.methods || {};
            classElement.constructor = classElement.constructor || {"params": []};
            classElement.constructor.params = classElement.constructor.params || [];

            for (var methodName in classElement.methods) {
                var methodElement = classElement.methods[methodName];
                methodElement.params = methodElement.params || [];
                methodElement.return = methodElement.return || 'void';
                methodElement.is_static = methodElement.is_static || false;
            }
        }
    }
}


var IOS_OSXManager = function(context, platformInfo, cppDir, classDefine, headerFiles, sourceFiles) {

    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util');

    var projectRoot = cordova_util.cdProjectRoot();

    var templateDir = path.join(projectRoot, 'plugins', pluginId, 'templates');

    var objc_headerTemplate = fs.readFileSync(path.join(templateDir, 'objc_header'), 'utf8');
    var objc_sourceTemplate = fs.readFileSync(path.join(templateDir, 'objc_source'), 'utf8');
    var objc_methodTemplate = fs.readFileSync(path.join(templateDir, 'objc_method'), 'utf8');
    var objc_getParamTemplate = '    /*PARAM_TYPE*/ param/*NUMBER*/ = [command.arguments objectAtIndex:/*INDEX*/];';
    var objc_prototypeTemplate = '- (void)/*METHOD*/:(CDVInvokedUrlCommand*)command;';
    var objc_getInstanceTemplate = '    /*CLASS*/ *instance = (/*CLASS*/*)(unsigned long)[[command.arguments objectAtIndex:0] longLongValue];';
    var objc_callMethodTemplate = '    /*RETURN*/instance->/*METHOD*/(/*PARAMS*/);';
    var objc_callStaticMethodTemplate = '    /*RETURN*//*CLASS*/::/*METHOD*/(/*PARAMS*/);';
    var objc_newInstanceTemplate = '    /*CLASS*/* ret = new /*CLASS*/(/*PARAMS*/);';

    var allClassList = Object.keys(classDefine);
    var destPluginDir = path.join(platformInfo.locations.xcodeCordovaProj, 'Plugins', pluginId);
    var destCppDir = path.join(destPluginDir, 'cpp');


    this.setup = function() {
        if (!fs.existsSync(destPluginDir)) {
            fs.mkdirSync(destPluginDir);
        }
        if (!fs.existsSync(destCppDir)) {
            fs.mkdirSync(destCppDir);
        }

        var xcode = context.requireCordovaModule('xcode');
        var pbxproj = platformInfo.locations.pbxproj;
        var proj = xcode.project(pbxproj);

        proj.parse(function(err) {
            copyCppFiles(context, cppDir, destCppDir, headerFiles, sourceFiles);
            addToPbxproj(proj, headerFiles, sourceFiles);

            createSource();

            proj.addHeaderFile(path.join(pluginId, bridgeFileName + '.h'));
            proj.addSourceFile(path.join(pluginId, bridgeFileName + '.mm'));

            fs.createReadStream(path.join(templateDir, 'ios_osx_NativeLog.h')).pipe(fs.createWriteStream(path.join(destPluginDir, 'NativeLog.h')));
            fs.createReadStream(path.join(templateDir, 'ios_osx_NativeLog.mm')).pipe(fs.createWriteStream(path.join(destPluginDir, 'NativeLog.mm')));
            proj.addHeaderFile(path.join(pluginId, 'NativeLog.h'));
            proj.addSourceFile(path.join(pluginId, 'NativeLog.mm'));

            fs.writeFileSync(pbxproj, proj.writeSync());
        });
    }

    function createSource() {
        var prototypeList = [];
        var methodList = [];

        for (var className in classDefine) {
            var classElement = classDefine[className];

            // constructor
            prototypeList.push(createContentWithTemplate(objc_prototypeTemplate, {'METHOD': className + '_new'}));
            methodList.push(createConstructor(classElement.constructor, className));

            // destructor
            prototypeList.push(createContentWithTemplate(objc_prototypeTemplate, {'METHOD': className + '_delete'}));
            methodList.push(createDestructor(className));

            // method
            for (methodName in classElement.methods) {
                var methodElement = classElement.methods[methodName];

                var prototype = createContentWithTemplate(objc_prototypeTemplate, {
                    'METHOD': className + ((methodElement.is_static) ? '_sm_' : '_mm_') + methodName
                });
                prototypeList.push(prototype);

                methodList.push(createMethod(methodElement, methodName, className));
            }
        }

        var includeList = headerFiles.map(function(f) {return '#include "' + f + '"'});

        var header = createContentWithTemplate(objc_headerTemplate, {
            'INCLUDE': includeList.join('\n'),
            'PROTOTYPE': prototypeList.join('\n')
        });
        fs.writeFileSync(path.join(destPluginDir, bridgeFileName + '.h'), header);

        var source = createContentWithTemplate(objc_sourceTemplate, {
            'SOURCE': methodList.join('\n')
        });
        fs.writeFileSync(path.join(destPluginDir, bridgeFileName + '.mm'), source);
    }

    function createConstructor(constructorElement, className) {
        methodParamList = [];
        toCppParamList = [];
        for (var i = 0; i < constructorElement.params.length; i++) {
            var paramType = getType_objc(constructorElement.params[i]);
            var methodParam = createContentWithTemplate(objc_getParamTemplate, {
                'PARAM_TYPE': paramType,
                'NUMBER': i,
                'INDEX': i
            });
            methodParamList.push(methodParam);

            var toCppParam = getToCppTypeWithParam_objc(constructorElement.params[i], 'param' + i);
            toCppParamList.push(toCppParam);
        }

        var messageAsType = getMessageAsType_objc(className);

        var callMethod = createContentWithTemplate(objc_newInstanceTemplate, {
            'CLASS': className,
            'PARAMS': toCppParamList.join(', ')
        });

        return createContentWithTemplate(objc_methodTemplate, {
            'METHOD': className + '_new',
            'GET_INSTANCE': '',
            'CALL_METHOD': callMethod,
            'PARAM_COUNT': constructorElement.params.length,
            'PARAMS': methodParamList.join('\n'),
            'MESSAGE_AS_TYPE': messageAsType
        });
    }

    function createDestructor(className) {
        var getInstance = createContentWithTemplate(objc_getInstanceTemplate, {
            'CLASS': className
        });

        var callMethod = '    delete instance;';

        return createContentWithTemplate(objc_methodTemplate, {
            'METHOD': className + '_delete',
            'GET_INSTANCE': getInstance,
            'CALL_METHOD': callMethod,
            'PARAM_COUNT': 1,
            'PARAMS': '',
            'MESSAGE_AS_TYPE': ''
        });
    }

    function createMethod(methodElement, methodName, className) {
        var methodParamList = [];
        var toCppParamList = [];

        var offset = 0;
        var getInstance = '';
        if (!methodElement.is_static) {
            getInstance = createContentWithTemplate(objc_getInstanceTemplate, {
                'CLASS': className
            });
            offset = 1;
        }

        for (var i = 0; i < methodElement.params.length; i++) {
            var paramType = getType_objc(methodElement.params[i]);
            var methodParam = createContentWithTemplate(objc_getParamTemplate, {
                'PARAM_TYPE': paramType,
                'NUMBER': i,
                'INDEX': i + offset
            });
            methodParamList.push(methodParam);

            var toCppParam = getToCppTypeWithParam_objc(methodElement.params[i], 'param' + i);
            toCppParamList.push(toCppParam);
        }

        var messageAsType = getMessageAsType_objc(methodElement.return);

        methodReturn = '';
        if (methodElement.return != 'void') {
            methodReturn = getType_cpp(methodElement.return) + ' ret = ';
        }
        var template = (methodElement.is_static) ? objc_callStaticMethodTemplate : objc_callMethodTemplate;
        var callMethod = createContentWithTemplate(template, {
            'CLASS': className,
            'METHOD': methodName,
            'RETURN': methodReturn,
            'PARAMS': toCppParamList.join(', ')
        });

        return createContentWithTemplate(objc_methodTemplate, {
            'METHOD': className + ((methodElement.is_static) ? '_sm_' : '_mm_') + methodName,
            'GET_INSTANCE': getInstance,
            'CALL_METHOD': callMethod,
            'PARAM_COUNT': methodElement.params.length + ((methodElement.is_static) ? 0 : 1),
            'PARAMS': methodParamList.join('\n'),
            'MESSAGE_AS_TYPE': messageAsType
        });
    }

    function addToPbxproj(proj, headerFiles, sourceFiles) {
        headerFiles.forEach(function(f) {
            proj.addHeaderFile(path.join(pluginId, 'cpp', f));
        });
        sourceFiles.forEach(function(f) {
            proj.addSourceFile(path.join(pluginId, 'cpp', f));
        });
    }

    function getType_objc(type) {
        if (allClassList.indexOf(type) > -1) {
            return 'NSString*';
        }
        return {
            'int': 'NSNumber*',
            'double': 'NSNumber*',
            'string': 'NSString*',
            'boolean': 'NSNumber*'
        }[type];
    }

    function getType_cpp(type) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            var className = allClassList[idx];
            return className + '*';
        }
        return {
            'int': 'int',
            'double': 'double',
            'string': 'const char*',
            'boolean': 'bool'
        }[type];
    }

    function getMessageAsType_objc(type) {
        if (allClassList.indexOf(type) > -1) {
            return 'messageAsString:[[NSNumber numberWithUnsignedLong:(unsigned long)ret] stringValue]';
        }
        return {
            'int': 'messageAsInt:ret',
            'double': 'messageAsDouble:ret',
            'string': 'messageAsString:[NSString stringWithUTF8String:ret]',
            'boolean': 'messageAsBool:(BOOL)ret',
            'void': ''
        }[type];
    }

    function getToCppTypeWithParam_objc(type, varName) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            var className = allClassList[idx];
            return '(' + className + '*)(unsigned long)[' + varName + ' longLongValue]';
        }
        return {
            'int': '[' + varName + ' intValue]',
            'double': '[' + varName + ' doubleValue]',
            'string': '[' + varName + ' UTF8String]',
            'boolean': '[' + varName + ' boolValue]'
        }[type];
    }
}


var AndroidManager = function(context, platformInfo, cppDir, classDefine, headerFiles, sourceFiles) {

    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        shell             = context.requireCordovaModule('shelljs'),
        properties_parser = context.requireCordovaModule('properties-parser'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util');

    var javaPackage = ['com', 'tkyaji', 'cordova'];

    var projectRoot = cordova_util.cdProjectRoot();

    var templateDir = path.join(projectRoot, 'plugins',  pluginId, '/templates');

    var cpp_sourceTemplate = fs.readFileSync(path.join(templateDir, 'cpp_source'), 'utf8');
    var cpp_methodTemplate = fs.readFileSync(path.join(templateDir, 'cpp_method'), 'utf8');
    var cpp_callMethodTemplate = '    /*RETURN*/cppInstance->/*METHOD*/(/*PARAMS*/);';
    var cpp_callStaticMethodTemplate = '    /*RETURN*//*CLASS*/::/*METHOD*/(/*PARAMS*/);';
    var cpp_newInstanceTempalte = '    /*RETURN*/new /*CLASS*/(/*PARAMS*/);';
    var cpp_getStringTemplate = '    const char *native_param/*INDEX*/ = env->GetStringUTFChars(param/*INDEX*/, 0);';
    var cpp_releaseStringTemplate = '    env->ReleaseStringUTFChars(param/*INDEX*/, native_param/*INDEX*/);';
    var cpp_getInstanceTemplate = '    /*CLASS*/ *cppInstance = (/*CLASS*/*)cppInstancePtr;';
    var java_sourceTemplate = fs.readFileSync(path.join(templateDir, 'java_source'), 'utf8');
    var java_methodTemplate = fs.readFileSync(path.join(templateDir, 'java_method'), 'utf8');
    var java_callMethodTemplate = '                        /*RETURN*//*METHOD*/(/*PARAMS*/);';
    var java_methodSignature = '    public static native /*JAVA_TYPE*/ /*METHOD*/(/*PARAMS*/);';

    var cmakeListTemplate = fs.readFileSync(path.join(templateDir, 'CMakeLists.txt'), 'utf8');

    var allClassList = Object.keys(classDefine);
    var destPluginDir = path.join(platformInfo.locations.root, 'src', javaPackage.join('/'));
    var destCppDir = path.join(platformInfo.locations.root, 'cpp');

    this.setup = function() {

        var tmpPath = path.join(platformInfo.locations.root, 'src');
        javaPackage.forEach(function(p) {
            tmpPath = path.join(tmpPath, p);
            if (!fs.existsSync(tmpPath)) {
                fs.mkdirSync(tmpPath);
            }
        });

        if (!fs.existsSync(destCppDir)) {
            fs.mkdirSync(destCppDir);
        }

        createSource();

        copyCppFiles(context, cppDir, destCppDir, headerFiles, sourceFiles);

        var cmakeListFile = createContentWithTemplate(cmakeListTemplate, {
            'SOURCE_FILES': sourceFiles.concat([bridgeFileName + '.cpp']).join(' ')
        });
        fs.writeFileSync(path.join(destCppDir, 'CMakeLists.txt'), cmakeListFile);

        fs.createReadStream(path.join(templateDir, 'android_NativeLog.h')).pipe(fs.createWriteStream(path.join(destCppDir, 'NativeLog.h')));

        if (!process.env.ANDROID_NDK_HOME) {
            if (process.env.ANDROID_HOME) {
                process.env.ANDROID_NDK_HOME = path.join(process.env.ANDROID_HOME, 'ndk-bundle');
            } else {
                process.env.ANDROID_NDK_HOME = path.join(shell.which('android').replace('/tools/android', ''), 'ndk-bundle');
            }
        }
        console.log('ANDROID_NDK_HOME=' + process.env.ANDROID_NDK_HOME);
    }

    function createSource() {
        var cppMethodList = [];
        var javaMethodList = [];
        var javaNativeMethodList = [];

        for (var className in classDefine) {
            var classElement = classDefine[className];

            // constructor
            cppMethodList.push(createCppConstructor(classElement.constructor, className));
            javaMethodList.push(createJavaConstructor(classElement.constructor, className));
            javaNativeMethodList.push(createJavaConstructorSignature(classElement.constructor, className));

            // destructor
            cppMethodList.push(createCppDestructor(className));
            javaMethodList.push(createJavaDestructor(className));
            javaNativeMethodList.push(createJavaDestructorSignature(className));

            // method
            for (var methodName in classElement.methods) {
                var methodElement = classElement.methods[methodName];

                cppMethodList.push(createCppMethod(methodElement, methodName, className));
                javaMethodList.push(createJavaMethod(methodElement, methodName, className));
                javaNativeMethodList.push(createJavaMethodSignature(methodElement, methodName, className));
            }
        }

        var includeList = headerFiles.map(function(f) {return '#include "' + f + '"'});

        var bridgeCpp = createContentWithTemplate(cpp_sourceTemplate, {
            'INCLUDE': includeList.join('\n'),
            'METHODS': cppMethodList.join('\n')
        });

        var bridgeJava = createContentWithTemplate(java_sourceTemplate, {
            'NATIVE_METHODS': javaNativeMethodList.join('\n'),
            'METHODS': javaMethodList.join('\n')
        });

        fs.writeFileSync(path.join(destPluginDir, bridgeFileName + '.java'), bridgeJava);
        fs.writeFileSync(path.join(destCppDir, bridgeFileName + '.cpp'), bridgeCpp);

        editBuildGradle();
    }


    function createCppConstructor(constructorElement, className) {

        var inParams = '';
        var toCppParamList = [];
        var getStringList = [];
        var releaseStringList = [];

        for (var i = 0; i < constructorElement.params.length; i++) {
            var paramType = constructorElement.params[i];
            var jType = getJType_cpp(paramType);
            inParams += ', ' + jType + ' param' + i;
            toCppParamList.push(getToCppTypeWithParam_cpp(paramType, 'param' + i));
            if (paramType == 'string') {
                getStringList.push(createContentWithTemplate(cpp_getStringTemplate, {'INDEX': i}));
                releaseStringList.push(createContentWithTemplate(cpp_releaseStringTemplate, {'INDEX': i}));
            }
        }

        var cppMethod = ['Java'].concat(javaPackage).concat([bridgeFileName, className + '0new']).join('_');

        var receiveReturn = getType_cpp(className) + ' ret = ';
        var methodReturn = '    return ' + getToJTypeWithParam_cpp(className, 'ret') + ';';
        var callMethod = createContentWithTemplate(cpp_newInstanceTempalte, {
            'CLASS': className,
            'RETURN': receiveReturn,
            'PARAMS': toCppParamList.join(', ')
        });

        return createContentWithTemplate(cpp_methodTemplate, {
            'JTYPE': getJType_cpp(className),
            'PARAMS': inParams,
            'METHOD': cppMethod,
            'CALL_METHOD': callMethod,
            'GET_INSTANCE': '',
            'GET_STRINGS': getStringList.join('\n'),
            'RELEASE_STRINGS': releaseStringList.join('\n'),
            'RETURN': methodReturn
        });
    }

    function createJavaConstructor(constructorElement, className) {

        var paramList = [];
        for (var i = 0; i < constructorElement.params.length; i++) {
            paramList.push(getJsonParamWithIndex_java(constructorElement.params[i], i));
        }

        var nativeMethodName = className + '0new';

        var callMethod = createContentWithTemplate(java_callMethodTemplate, {
            'METHOD': nativeMethodName,
            'PARAMS': paramList.join(', '),
            'RETURN': 'long ret = '
        });

        return createContentWithTemplate(java_methodTemplate, {
            'ACTION': className + '_new',
            'CALL_METHOD': callMethod,
            'PARAM_COUNT': paramList.length,
            'RETURN': ', String.valueOf(ret)'
        });
    }

    function createJavaConstructorSignature(constructorElement, className) {

        var nativeMethodName = className + '0new';

        var paramList = [];
        for (var i = 0; i < constructorElement.params.length; i++) {
            paramList.push(getType_java(constructorElement.params[i]) + ' param' + i);
        }

        return createContentWithTemplate(java_methodSignature, {
            'JAVA_TYPE': getType_java(className),
            'METHOD': nativeMethodName,
            'PARAMS': paramList.join(', ')
        });
    }

    function createCppDestructor(className) {

        var inParams = ', jlong cppInstancePtr';

        var cppMethod = ['Java'].concat(javaPackage).concat([bridgeFileName, className + '0delete']).join('_');

        var getInstance = createContentWithTemplate(cpp_getInstanceTemplate, {'CLASS': className});

        var callMethod = '    delete cppInstance;';

        return createContentWithTemplate(cpp_methodTemplate, {
            'JTYPE': 'void',
            'PARAMS': inParams,
            'METHOD': cppMethod,
            'CALL_METHOD': callMethod,
            'GET_INSTANCE': getInstance,
            'GET_STRINGS': '',
            'RELEASE_STRINGS': '',
            'RETURN': ''
        });
    }

    function createJavaDestructorSignature(className) {

        var nativeMethodName = className + '0delete';

        var paramList = [];
        paramList.push(getType_java(className) + ' param0');

        return createContentWithTemplate(java_methodSignature, {
            'JAVA_TYPE': 'void',
            'METHOD': nativeMethodName,
            'PARAMS': paramList.join(', ')
        });
    }

    function createJavaDestructor(className) {

        var nativeMethodName = className + '0delete';

        var paramList = [];
        paramList.push(getType_java(className) + ' param0');

        callMethod = '                        ' + nativeMethodName + '(' + getJsonParamWithIndex_java(className, 0) + ');';

        return createContentWithTemplate(java_methodTemplate, {
            'ACTION': className + '_delete',
            'CALL_METHOD': callMethod,
            'RETURN': '',
            'PARAM_COUNT': paramList.length
        });
    }

    function createCppMethod(methodElement, methodName, className) {

        var inParams = '';
        var toCppParamList = [];
        var getStringList = [];
        var releaseStringList = [];

        if (!methodElement.is_static) {
            inParams += ', jlong cppInstancePtr';
        }
        for (var i = 0; i < methodElement.params.length; i++) {
            var paramType = methodElement.params[i];
            var jType = getJType_cpp(paramType);
            inParams += ', ' + jType + ' param' + i;
            toCppParamList.push(getToCppTypeWithParam_cpp(paramType, 'param' + i));
            if (paramType == 'string') {
                getStringList.push(createContentWithTemplate(cpp_getStringTemplate, {'INDEX': i}));
                releaseStringList.push(createContentWithTemplate(cpp_releaseStringTemplate, {'INDEX': i}));
            }
        }

        var methodType = (methodElement.is_static) ? 'sm': 'mm';
        var cppMethod = ['Java'].concat(javaPackage).concat([bridgeFileName]).join('_') + '_' + [className, methodType, methodName].join('0');

        var getInstance = '';
        if (!methodElement.is_static) {
            getInstance = createContentWithTemplate(cpp_getInstanceTemplate, {'CLASS': className});
        }

        var receiveReturn = '';
        var methodReturn = '';
        if (methodElement.return != 'void') {
            receiveReturn = getType_cpp(methodElement.return) + ' ret = ';
            methodReturn = '    return ' + getToJTypeWithParam_cpp(methodElement.return, 'ret') + ';';
        }
        var template = (methodElement.is_static) ? cpp_callStaticMethodTemplate : cpp_callMethodTemplate;
        var callMethod = createContentWithTemplate(template, {
            'CLASS': className,
            'METHOD': methodName,
            'RETURN': receiveReturn,
            'PARAMS': toCppParamList.join(', ')
        });

        return createContentWithTemplate(cpp_methodTemplate, {
            'JTYPE': getJType_cpp(methodElement.return),
            'PARAMS': inParams,
            'METHOD': cppMethod,
            'CALL_METHOD': callMethod,
            'GET_INSTANCE': getInstance,
            'GET_STRINGS': getStringList.join('\n'),
            'RELEASE_STRINGS': releaseStringList.join('\n'),
            'RETURN': methodReturn
        });
    }

    function createJavaMethodSignature(methodElement, methodName, className) {

        var methodType = (methodElement.is_static) ? 'sm': 'mm';
        var nativeMethodName = [className, methodType, methodName].join('0');

        var paramList = [];
        var idx = 0;
        if (!methodElement.is_static) {
            paramList.push(getType_java(className) + ' param' + idx);
            idx++;
        }
        for (var i = 0; i < methodElement.params.length; i++) {
            paramList.push(getType_java(methodElement.params[i]) + ' param' + idx);
            idx++;
        }

        return createContentWithTemplate(java_methodSignature, {
            'JAVA_TYPE': getType_java(methodElement.return),
            'METHOD': nativeMethodName,
            'PARAMS': paramList.join(', ')
        });
    }

    function createJavaMethod(methodElement, methodName, className) {

        var paramList = [];

        var idx = 0;
        if (!methodElement.is_static) {
            paramList.push(getJsonParamWithIndex_java(className, idx));
            idx++;
        }
        for (var i = 0; i < methodElement.params.length; i++) {
            paramList.push(getJsonParamWithIndex_java(methodElement.params[i], idx));
            idx++;
        }

        var methodType = (methodElement.is_static) ? 'sm': 'mm';
        var nativeMethodName = [className, methodType, methodName].join('0');
        var actionName = [className, methodType, methodName].join('_');

        var receiveReturn = '';
        var methodReturn = '';
        if (methodElement.return != 'void') {
            receiveReturn = getType_java(methodElement.return) + ' ret = ';
            if (methodElement.return == 'double') {
                methodReturn =  ', new JSONObject("{ret:" + ret + "}")';
            } else {
                methodReturn = ', ret';
            }
        }

        var callMethod = createContentWithTemplate(java_callMethodTemplate, {
            'METHOD': nativeMethodName,
            'PARAMS': paramList.join(', '),
            'RETURN': receiveReturn
        });

        return createContentWithTemplate(java_methodTemplate, {
            'ACTION': actionName,
            'CALL_METHOD': callMethod,
            'RETURN': methodReturn,
            'PARAM_COUNT': paramList.length
        });
    }

    function editBuildGradle() {
        var gradlePath = path.join(platformInfo.locations.root, 'build.gradle');
        var gradle = fs.readFileSync(gradlePath, 'utf8');
        if (!/cpp\/CMakeLists.txt/.test(gradle)) {
            var target = 'android {';
            var index = gradle.indexOf(target);
            if (index > -1) {
                var cmake = '    externalNativeBuild { cmake { path \'cpp/CMakeLists.txt\' } }'
                gradle = gradle.replace('android {', target + '\n' + cmake);

                fs.writeFileSync(gradlePath, gradle);
            }
        }
    }

    function getJType_cpp(type) {
        if (allClassList.indexOf(type) > -1) {
            return 'jlong';
        }
        return {
            'int': 'jint',
            'double': 'jdouble',
            'string': 'jstring',
            'boolean': 'jboolean',
            'void': 'void'
        }[type];
    }

    function getType_cpp(type) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            var className = allClassList[idx];
            return className + '*';
        }
        return {
            'int': 'int',
            'double': 'double',
            'string': 'const char*',
            'boolean': 'bool'
        }[type];
    }

    function getType_java(type) {
        if (allClassList.indexOf(type) > -1) {
            return 'long';
        }
        return {
            'int': 'int',
            'double': 'double',
            'string': 'String',
            'boolean': 'boolean',
            'void': 'void'
        }[type];
    }

    function getToCppTypeWithParam_cpp(type, varName) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            var className = allClassList[idx];
            return '(' + className + '*)(long long)' + varName;
        }
        return {
            'int': '(int)' + varName,
            'double': '(double)' + varName,
            'string': 'native_' + varName,
            'boolean': '(bool)' + varName
        }[type];
    }

    function getToJTypeWithParam_cpp(type, varName) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            return '(jlong)' + varName;
        }
        return {
            'int': '(jint)' + varName,
            'double': '(jdouble)' + varName,
            'string': 'env->NewStringUTF(' + varName + ');',
            'boolean': '(jboolean)' + varName
        }[type];
    }

    function getJsonParamWithIndex_java(type, i) {
        var idx = allClassList.indexOf(type);
        if (idx > -1) {
            return 'Long.parseLong(data.getString(' + i + '))';
        }
        return {
            'int': 'data.getInt(' + i + ')',
            'double': 'data.getDouble(' + i + ')',
            'string': 'data.getString(' + i + ')',
            'boolean': 'data.getBoolean(' + i + ')'
        }[type];
    }
}


var JsManager = function(context, platformInfo, classDefine) {

    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util');

    var projectRoot = cordova_util.cdProjectRoot();

    var js_sourceTemplate = fs.readFileSync(path.join(projectRoot, 'plugins' , pluginId, 'templates/js_source'), 'utf8');
    var js_classTemplate = fs.readFileSync(path.join(projectRoot, 'plugins' , pluginId, 'templates/js_class'), 'utf8');
    var js_methodTemplate = fs.readFileSync(path.join(projectRoot, 'plugins' , pluginId, 'templates/js_method'), 'utf8');
    var js_staticMethodTemplate = fs.readFileSync(path.join(projectRoot, 'plugins' , pluginId, 'templates/js_static_method'), 'utf8');

    var allClassList = Object.keys(classDefine);
    var destPluginDir = platformInfo.locations.configXml.replace('/config.xml', '/Plugins/' + pluginId);


    this.setup = function() {

        var classList = [];

        for (var className in classDefine) {
            var classElement = classDefine[className];

            var classContent = createClass(classElement, className);
            classList.push(classContent);
        }

        var source = createContentWithTemplate(js_sourceTemplate, {
            'CLASSES': classList.join(',\n'),
            'PLUGIN_ID': pluginId,
            'PLUGIN_NAME': pluginName
        });

        var wwwDir = path.join(platformInfo.locations.www, 'plugins', pluginId, 'www');
        fs.writeFileSync(path.join(wwwDir, bridgeFileName + '.js'), source);

        var platformWwwDir = path.join(platformInfo.locations.platformWww, 'plugins', pluginId, 'www');
        if (platformWwwDir) {
            fs.writeFileSync(path.join(platformWwwDir, bridgeFileName + '.js'), source);
        }
    }

    function createClass(classElement, className) {

        var params = range(classElement.constructor.params.length).map(function(i) {return 'param' + i});
        var constructorParams = (params.length == 0) ? '' : params.join(', ') + ', ';
        range(range.length).forEach(function(i) {
            if (allClassList.indexOf(classElement.constructor.params[i]) > -1) {
                params[i] += '._instanceId';
            }
        });
        var constructorExecParams = ', [' + params.join(', ') + ']';

        var methodList = [];
        var staticMethodList = [];
        for (methodName in classElement.methods) {
            var methodElement = classElement.methods[methodName];
            var method = createMethod(methodElement, methodName, className);
            if (methodElement.is_static) {
                staticMethodList.push(method);
            } else {
                methodList.push(method);
            }
        }
        if (methodList.length > 0) {
            methodList.unshift('');
        }
        if (staticMethodList.length > 0) {
            staticMethodList.unshift('');
        }

        return createContentWithTemplate(js_classTemplate, {
            'CLASS': className,
            'CONSTRUCTOR_PARAMS': constructorParams,
            'METHODS': methodList.join(',\n'),
            'STATIC_METHODS': staticMethodList.join(',\n'),
            'EXEC_PARAMS': constructorExecParams,
            'PLUGIN_NAME': pluginName
        });
    }

    function createMethod(methodElement, methodName, className) {

        var params = range(methodElement.params.length).map(function(i) {return 'param' + i});
        var methodParams = (params.length == 0) ? '' : params.join(', ') + ', ';
        range(range.length).forEach(function(i) {
            if (allClassList.indexOf(methodElement.params[i]) > -1) {
                params[i] += '._instanceId';
            }
        });
        if (!methodElement.is_static) {
            params.unshift('instanceId');
        }
        var execParams = ', [' + params.concat([]).join(', ') + ']';

        var methodJs = methodName;
        var methodNative = className + ((methodElement.is_static) ? '_sm_' : '_mm_') + methodName;
        var indent = ((methodElement.is_static) ? '            ' : '                            ');

        return createContentWithTemplate(js_methodTemplate, {
            'METHOD_JS': methodJs,
            'METHOD_PARAMS': methodParams,
            'METHOD_NATIVE': methodNative,
            'EXEC_PARAMS': execParams,
            'PLUGIN_NAME': pluginName,
            'INDEND': indent
        });
    }
}


function copyCppFiles(context, cppDir, destCppDir, headerFiles, sourceFiles) {
    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs');

    headerFiles.forEach(function(f) {
        fs.createReadStream(path.join(cppDir, f)).pipe(fs.createWriteStream(path.join(destCppDir, f)));
    });
    sourceFiles.forEach(function(f) {
        fs.createReadStream(path.join(cppDir, f)).pipe(fs.createWriteStream(path.join(destCppDir, f)));
    });
}

function createContentWithTemplate(template, replace) {
    var content = template;
    for (var key in replace) {
        var val = replace[key];
        content = content.replace(new RegExp('\\/\\*' + key + '\\*\\/', 'g'), val);
    }
    return content;
}

function range(i1, i2) {
    start = i1;
    end = i2;
    if (end == null) {
        start = 0;
        end = i1;
    }
    list = [];
    for (var i = start; i < end; i++) {
        list.push(i);
    }
    return list;
}
