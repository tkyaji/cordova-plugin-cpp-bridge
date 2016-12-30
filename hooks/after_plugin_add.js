var pluginId = 'cordova-plugin-cpp-bridge';

module.exports = function(context) {

    if (context.opts.plugins[0].indexOf(pluginId) == -1) {
        return;
    }

    var path              = context.requireCordovaModule('path'),
        fs                = context.requireCordovaModule('fs'),
        cordova_util      = context.requireCordovaModule('cordova-lib/src/cordova/util');

    var projectRoot = cordova_util.cdProjectRoot();
    var pluginCppDir = path.join(projectRoot, 'plugins/' + pluginId + '/cpp');

    var cppDir = path.join(projectRoot, 'cpp');
    if (!fs.existsSync(cppDir)){
        fs.mkdirSync(cppDir);
    }

    fs.readdir(pluginCppDir, function(err, files) {
        if (err) return;
        files.filter(function(f) {
            return !fs.existsSync(path.join(cppDir, f));
        }).forEach(function(f) {
            fs.createReadStream(path.join(pluginCppDir, f)).pipe(fs.createWriteStream(path.join(cppDir, f)));
        });
    });
}
