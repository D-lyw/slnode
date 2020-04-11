/**
 * 路径分离
 */

const path = require('path')

module.exports = function pathSplitter(pathString) {
    let parent
    if (pathString.indexOf('/') === 0) {
        pathString = pathString.substring(1)
    }
    if (pathString === '') {
        return { parentPath: '', pathPart: ''}
    }
    parent = path.dirname(pathString)
    if (parent === '.') {
        parent = ''
    }
    return { parentPath: parent, pathPart: path.basename(pathString)}

}