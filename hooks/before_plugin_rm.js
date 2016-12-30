var pluginId = 'cordova-plugin-cpp-bridge';
var bridgeFileName = 'CDVCppBridge';

module.exports = function(context) {

    if (context.opts.plugins[0].indexOf(pluginId) == -1) {
        return;
    }

    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        platforms         = context.requireCordovaModule('cordova-lib/src/platforms/platforms'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util');

    var projectRoot = cordova_util.cdProjectRoot();
    var cppDir = path.join(projectRoot, 'cpp');
    var classDefineJson = JSON.parse(fs.readFileSync(path.join(cppDir, 'class_define.json'), 'utf-8'));
    var headerFiles = classDefineJson.header_files;
    var sourceFiles = classDefineJson.source_files;

    context.opts.cordova.platforms.forEach(function(platform) {
        var platformPath = path.join(projectRoot, 'platforms', platform);
        var platformApi = platforms.getPlatformApi(platform, platformPath);
        var platformInfo = platformApi.getPlatformInfo();

        if (platform == 'ios' || platform == 'osx') {
            removeFiles_ios_osx(platformInfo);

        } else if (platform == 'android') {
            removeFiles_android(platformInfo);
        }
    });


    function removeFiles_ios_osx(platformInfo) {
        var xcode = context.requireCordovaModule('xcode');
        var pbxproj = platformInfo.locations.pbxproj;
        var proj = xcode.project(pbxproj);

        proj.parse(function(err) {
            var destPluginDir = path.join(platformInfo.locations.xcodeCordovaProj, 'Plugins', pluginId);
            var destCppDir = path.join(destPluginDir, 'cpp');

            headerFiles.filter(function(f) {
                return fs.existsSync(path.join(destCppDir, f));
            }).forEach(function(f) {
                proj.removeHeaderFile(path.join(pluginId, 'cpp', f));
                fs.unlinkSync(path.join(destCppDir, f));
            });

            sourceFiles.filter(function(f) {
                return fs.existsSync(path.join(destCppDir, f));
            }).forEach(function(f) {
                proj.removeSourceFile(path.join(pluginId, 'cpp', f));
                fs.unlinkSync(path.join(destCppDir, f));
            });

            if (fs.existsSync(destCppDir)) {
                fs.rmdirSync(destCppDir);
            }

            if (fs.existsSync(path.join(destPluginDir, bridgeFileName + '.h'))) {
                proj.removeHeaderFile(path.join(pluginId, bridgeFileName + '.h'));
                fs.unlinkSync(path.join(destPluginDir, bridgeFileName + '.h'));
            }
            if (fs.existsSync(path.join(destPluginDir, bridgeFileName + '.mm'))) {
                proj.removeSourceFile(path.join(pluginId, bridgeFileName + '.mm'));
                fs.unlinkSync(path.join(destPluginDir, bridgeFileName + '.mm'));
            }

            if (fs.existsSync(path.join(destPluginDir, 'NativeLog.h'))) {
                proj.removeHeaderFile(path.join(pluginId, 'NativeLog.h'));
                fs.unlinkSync(path.join(destPluginDir, 'NativeLog.h'));
            }
            if (fs.existsSync(path.join(destPluginDir, 'NativeLog.mm'))) {
                proj.removeSourceFile(path.join(pluginId, 'NativeLog.mm'));
                fs.unlinkSync(path.join(destPluginDir, 'NativeLog.mm'));
            }

            if (fs.existsSync(destPluginDir)) {
                fs.rmdirSync(destPluginDir);
            }

            fs.writeFileSync(pbxproj, proj.writeSync());
        });
    }

    function removeFiles_android(platformInfo) {
        var javaPackage = ['com', 'tkyaji', 'cordova'];
        var destPluginDir = path.join(platformInfo.locations.root, 'src', javaPackage.join('/'));
        var destCppDir = path.join(platformInfo.locations.root, 'cpp');

        headerFiles.filter(function(f) {
            return fs.existsSync(path.join(destCppDir, f));
        }).forEach(function(f) {
            fs.unlinkSync(path.join(destCppDir, f));
        });

        sourceFiles.filter(function(f) {
            return fs.existsSync(path.join(destCppDir, f));
        }).forEach(function(f) {
            fs.unlinkSync(path.join(destCppDir, f));
        });

        if (fs.existsSync(path.join(destCppDir, 'NativeLog.h'))) {
            fs.unlinkSync(path.join(destCppDir, 'NativeLog.h'));
        }

        if (fs.existsSync(path.join(destPluginDir, bridgeFileName + '.java'))) {
            fs.unlinkSync(path.join(destPluginDir, bridgeFileName + '.java'));
        }

        for (var i = javaPackage.length; i >= 1 ; i--) {
            var dir = path.join(platformInfo.locations.root, 'src', javaPackage.slice(0, i).join('/'));
            if (fs.existsSync(dir) && fs.readdirSync(dir).length == 0) {
                fs.rmdirSync(dir);
            }
        }

        if (fs.existsSync(path.join(destCppDir, bridgeFileName + '.cpp'))) {
            fs.unlinkSync(path.join(destCppDir, bridgeFileName + '.cpp'));
        }

        if (fs.existsSync(path.join(destCppDir, 'CMakeLists.txt'))) {
            fs.unlinkSync(path.join(destCppDir, 'CMakeLists.txt'));
        }

        if (fs.existsSync(destCppDir)) {
            fs.rmdirSync(destCppDir);
        }

        var gradlePath = path.join(platformInfo.locations.root, 'build.gradle');
        var gradle = fs.readFileSync(gradlePath, 'utf8');
        if (/cpp\/CMakeLists.txt/.test(gradle)) {
            var match = gradle.match(/externalNativeBuild\s*{\s*cmake\s*{\s*path\s*\'cpp\/CMakeLists.txt\'\s*}\s*}/);
            if (match) {
                fs.writeFileSync(gradlePath, gradle.replace(match[0], ''));
            }
        }
    }

}
