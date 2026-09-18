const baseParse = require('@babel/parser')
const traverse = require('@babel/traverse')
const generator = require('@babel/generator')
const { getOptions } = require('loader-utils')

const {
    localeWordPattern,
} = require('./transform.js')

const {
    getKey,
    addCollection,
    allFileCollection,
    isSameRound } = require('../mycommon/collect')

const localePattern = /[\u4e00-\u9fa5]/ // chinese
function cnTextCollect(code) {
    const { resourcePath } = this
    // 获取options
    const {
        includes = [],
        excludes = [],
    } = getOptions(this) || {}
    //根据文件来判断是否需要收集中文
    if (excludes.length && excludes.some(item => resourcePath.indexOf(item) === 0)) {
        return code
    }
    if (includes.length && includes.every(item => resourcePath.indexOf(item) !== 0)) {
        return code
    }
    const fileCollection = {}
    let ast = baseParse.parse(code, {
        sourceType: 'unambiguous'
    })
    /**
    * 判断该节点是否应该被收集中文文本
    * @param {object} path 
    * @returns {boolean}该节点是否有注释no-i18n-auto
    */
    function findCommentExclude(path) {
        //If from TemplateLiteral to StringLiteral
        if (!path.node.loc) {
            return false
        }
        //节点所在的行
        const startLine = path.node.loc.start.line
        const leadingComments = path.node.leadingComments
        //检查是否有注释
        const check = (commentList) => {
            if (commentList && commentList.length) {
                const end = commentList.some(comment => {
                    return comment.type === 'CommentBlock' && comment.value.trim() === 'no-i18n-auto' && comment.loc.start.line === startLine
                })
                return end
            }
        }
        return (check(leadingComments) || check(ast.comments))
    }
    const visitor = {
        StringLiteral(path) {
            // 排除导入导出语句
            if (['ExportAllDeclaration', 'ImportDeclaration', 'ExportNamedDeclaration'].indexOf(path.parent.type) !== -1) {
                return
            }
            //排除注释了不收集的节点
            if (findCommentExclude(path)) {
                return
            }
            //检查是否为中文并且将其加入fileCollection
            if (path.node.type === 'StringLiteral') {
                const val = path.node.value
                if (localePattern.test(val)) {
                    const res = localeWordPattern(val)
                    if (res && res.length) {
                        res.forEach(word => {
                            const key = getKey(word)
                            fileCollection[key] = word
                        })
                    }

                }
            }

        },
        TemplateLiteral(path) {
            debugger;
            if (findCommentExclude(path)) {
                return
            }
            const hasWord = path.node.quasis.some(item => localePattern.test(item.value.raw))
            if (!hasWord) {
                return
            }
            //${} 模板字符串中变量的处理
            let sections = path.node.expressions.map(node => {
                return {
                    start: node.start,
                    // 将节点生成code后，用()包裹，防止变量名与中文冲突
                    value: `(${generator.default(node).code})`
                }
            })
            // 模版字符串中的静态文本
            path.node.quasis.forEach(node => {
                const string = node.value.raw
                if (string) {
                    // 将"写成\"
                    const _string = string.replace(/"/g, '\\"')
                    const element = {
                        start: node.start,
                        // value: "'" + _string + "'"
                        value: "" + _string + ""
                    }
                    const unshiftIndex = sections.findIndex(item => node.start < item.start)
                    unshiftIndex === -1 ? sections.push(element) : sections.splice(unshiftIndex, 0, element)
                }
            })
            //要为stringliteral加上""，如果为"(x) + 中文" 中文会被识别为变量，而不是字符串
            let code = sections.map(item => item.value).join('+')
            code.indexOf('\n') !== -1 && (code = code.replace(/\n/g, '\\n'))
            code.indexOf('\r') !== -1 && (code = code.replace(/\r/g, '\\r'))
            code.indexOf('\t') !== -1 && (code = code.replace(/\t/g, '\\t'))
            //替换节点 遍历时就可获取新节点
            path.replaceWithSourceString(code)
        }
    }
    //遍历整个节点
    traverse.default(ast, visitor)
    //如果有中文，则将其加入整个项目的collection

    //如果是相同的编译轮次，则将其加入所有文件的collection 因为一个resourcepath在一个编译轮次中可能会被进入多次，所以需要合并之前的结果
    let keys = Object.keys(allFileCollection)
    if (isSameRound[0] && keys.includes(resourcePath) && allFileCollection[resourcePath]) {
        Object.assign(fileCollection, allFileCollection[resourcePath])
    }
    addCollection(fileCollection, resourcePath)
    return code
}
module.exports = cnTextCollect
