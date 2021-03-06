/**
 * @file The component json processor
 * @author sparklewhy@gmail.com
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {file: fileUtil, string: strUtil} = require('../../util');
const {getFileName, getFileState} = fileUtil;
const {toHyphen} = strUtil;
const USING_COMPONENT_KEY = 'usingComponents';

/**
 * The native component file ext names
 *
 * @const
 * @type {Object}
 */
const COMPONENT_FILE_EXT_NAMES = {
    wxml: 'isWxCompScript',
    swan: 'isSwanCompScript',
    axml: 'isAntCompScript',
    ttml: 'isTTCompScript',
    acss: false,
    ttss: false,
    wxss: false,
    css: false,
    js: false
};

/**
 * Initialize the file list information in the given directory.
 * Return the file info structure:
 * {
 *    'fileName1': ['fullPath11', 'fullPath12'],
 *    'fileName2': ['fullPath21', 'fullPath22']'
 * }
 *
 * e.g., the dir `/test/src` has files: `/test/src/a.js`, `/test/src/a.css`
 * then response:
 * {
 *     'a': ['/test/src/a.js', '/test/src/a.css']
 * }
 *
 * @inner
 * @param {string} dir the directory to init
 * @param {CacheManager} cache the cache manager
 * @return {Object}
 */
function initDirFiles(dir, cache) {
    let cacheDirFiles = {};
    cache.setDirFileListInfo(dir, cacheDirFiles);

    let files = fs.readdirSync(dir);
    for (let i = 0, len = files.length; i < len; i++) {
        let file = files[i];
        let fullPath = path.resolve(dir, file);

        let stat = getFileState(fullPath);
        if (!stat || stat.isDirectory()) {
            continue;
        }

        let fileName = getFileName(fullPath);
        let fileList = cacheDirFiles[fileName];
        if (!fileList) {
            fileList = cacheDirFiles[fileName] = [];
        }
        fileList.push(fullPath);
    }

    return cacheDirFiles;
}

function isFileInSourceDir(filePath, sourceDir) {
    return filePath.indexOf(sourceDir + '/') === 0;
}

/**
 * Add component same name files
 *
 * @inner
 * @param {Object} scriptFile the component script file
 * @param {Object} options the process options
 */
function addComponentSameNameFiles(scriptFile, options) {
    const {dirname: currDir, path: relPath} = scriptFile;
    const scriptFileName = getFileName(relPath);
    const {cache, addFile, sourceDir, getFileByFullPath} = options;
    let cacheDirFiles = cache.getDirFileListInfo(currDir);

    let jsonFile;
    let toAddFiles = [];
    if (!isFileInSourceDir(scriptFile.path, sourceDir)) {
        if (!cacheDirFiles) {
            cacheDirFiles = initDirFiles(currDir, cache);
        }

        let sameNameFiles = cacheDirFiles[scriptFileName];
        let sameNameFileNum = sameNameFiles ? sameNameFiles.length : 0;
        for (let i = 0; i < sameNameFileNum; i++) {
            let fileObj = addFile(sameNameFiles[i]);
            let extname = fileObj.extname;

            let flagKey = COMPONENT_FILE_EXT_NAMES[extname];
            if (typeof flagKey === 'string') {
                // add flag for native component script
                scriptFile[flagKey] = true;
            }
            else if (fileObj.isJson) {
                jsonFile = fileObj;
            }
        }
    }
    else {
        let filePathBase = `${currDir}/${scriptFileName}`;
        jsonFile = getFileByFullPath(`${filePathBase}.json`);

        if (jsonFile && !jsonFile.owner) {
            Object.keys(COMPONENT_FILE_EXT_NAMES).forEach(k => {
                let f = getFileByFullPath(`${filePathBase}.${k}`);
                if (f) {
                    toAddFiles.push(f.fullPath);
                    let flagKey = COMPONENT_FILE_EXT_NAMES[k];
                    // add flag for native component script
                    typeof flagKey === 'string' && (scriptFile[flagKey] = true);
                }
            });
        }
    }

    if (jsonFile) {
        jsonFile.isComponentConfig = true;
        jsonFile.component = scriptFile;

        toAddFiles.push(jsonFile.fullPath);
    }

    toAddFiles.forEach(item => addFile(item));
}

/**
 * Analysis native component
 *
 * @inner
 * @param {Object} scriptFile the component script file
 * @param {Object} options the process options
 */
function analyseNativeComponent(scriptFile, options) {
    // check whether component is analysed, if true, ignore
    if (scriptFile.isAnalysedComponents) {
        return;
    }
    scriptFile.isAnalysedComponents = true;

    let {appType} = options;
    if (appType === 'quick') {
        return;
    }

    // add native component definition files
    addComponentSameNameFiles(scriptFile, options);
}

/**
 * Process the component dependence sub components based on `usingComponent`
 * info defined in json.
 *
 * @param {Object} file the file to process
 * @param {Object} options the compile options
 * @return {{content: string}}
 */
function compile(file, options) {
    const {resolve: resolveDep, logger} = options;

    try {
        let componentConf = JSON.parse(file.content.toString());
        let usingComponents = componentConf[USING_COMPONENT_KEY];
        if (!usingComponents || !file.component) {
            return {content: file.content};
        }

        let result = {};
        let scriptFile = file.component;
        Object.keys(usingComponents).forEach(k => {
            let value = usingComponents[k];
            if (!value) {
                return;
            }

            let resolvePath = resolveDep(
                scriptFile, value
            );
            result[toHyphen(k)] = resolvePath || value;

            let resolveModInfo = scriptFile.resolvedModIds[value];
            let componentFile = resolveModInfo && resolveModInfo.file;
            componentFile && analyseNativeComponent(componentFile, options);
        });

        // update usingComponent information
        componentConf[USING_COMPONENT_KEY] = result;

        return {
            content: JSON.stringify(componentConf, null, 4)
        };
    }
    catch (ex) {
        logger.error(
            `Parse component config ${file.path} fail`,
             ex.stack || ex.toString()
        );
    }

    return {content: file.content};
}

module.exports = exports = compile;
