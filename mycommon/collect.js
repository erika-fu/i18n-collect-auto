const md5 = require('md5');
const fs = require('fs');
const path = require('path');
const { json } = require('body-parser');

// 收集所有中文文本，所有文件共享一个collection，以文件path为key，value为收集到的{md5key:chinesetext}
const allFileCollection = {}
// 收集此轮构建中的中文的md5key，以文件path为key，value为收集到为该文件本轮收集到的md5key数组
const allFilekey = {}
// 是否是同一轮构建
let isSameRound = [false]
// 上一轮构建收集到的所有中文
let existingContent = ''


/**
 * 生成文本的MD5 hash键
 * @param {string} word - 中文文本
 * @returns {string} MD5 hash值
 */
function getKey(word) {
    return md5(word);
}

/**
 * 添加收集的文本到全局集合
 * @param {Object} collection - 键值对
 */
function addCollection(fileCollection, resourcePath) {
    //初始化
    isSameRound[0] = true
    allFileCollection[resourcePath] = allFileCollection[resourcePath] ?? {}
    allFilekey[resourcePath] = allFilekey[resourcePath] ?? []
    //获取本次构建收集的key和文本
    Object.assign(allFileCollection[resourcePath], fileCollection)
    const keys = Object.keys(fileCollection)
    for (let key of keys) {
        if (!allFilekey[resourcePath].includes(key)) {
            allFilekey[resourcePath].push(key)
        }
    }
    reCollection(resourcePath)
}
/**
 * 重置每一次构建的收集结果，只有被重新构建的文件才受影响，不被构建的文件的收集结果不会被清空
 * 最终的allcollection为本轮构建最终收集到的中文文本，这样增加或减少都可以被检测
 * @param {*} resourcePath 
 */
function reCollection(resourcePath) {
    const allCollection = allFileCollection[resourcePath]
    const roundKey = allFilekey[resourcePath]
    const keys = Object.keys(allCollection)
    for (let key of keys) {
        if (!roundKey.includes(key)) {
            delete allCollection[key]
        }
    }
    // 在下一轮构建前，清空本轮构建的key
    allFilekey[resourcePath].length = 0
}

/**
 * 获取所有收集的文本
 * @returns {Object} 所有键值对
 */
function getAllCollection(allFileCollection) {
    let allProCollction = {}
    for (let resourcePath of Object.keys(allFileCollection)) {
        Object.assign(allProCollction, allFileCollection[resourcePath])
    }
    return JSON.stringify(allProCollction)
}

/**
 * 将收集的文本写入文件
 * @param {Object} options - 写入选项
 * @param {string} options.path - 文件路径
 * @param {string} options.filename - 文件名
 */

function createFile(filepath, filename) {
    //在下一轮构建前重置轮数
    isSameRound[0] = false
    const content = getAllCollection(allFileCollection)
    // 可能触发构建了但是收集到的文本并无变化，这种情况不应该写入文件
    if(existingContent === content){
        console.log("文件无变化，跳过写入");
        return Promise.resolve()
    }else{
        //
        existingContent = content
        return new Promise((resolve, reject) => {
            [
                fs.mkdir(filepath, { recursive: true }, err => {
                    if (err) {
                        return reject(err)
                    }
                    fs.writeFile(path.resolve(filepath, filename), content, err => {
                        if (err) {
                            return reject(err)
                        }
                        return resolve()
                    })
                })
            ]
        })
    }
}



module.exports = {
    getKey,
    getAllCollection,
    createFile,
    addCollection,
    allFileCollection,
    isSameRound,
}