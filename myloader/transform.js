const types = require('@babel/types')

const localePattern = /[\u4e00-\u9fa5]/ // chinese

/**
 * 
 * @param {string} word 
 * @returns {string[]} 中文数组
 */
const localeWordPattern = (word) => {
    const pattern = localePattern
    if (!pattern.test(word)) {
        return null
    }
    const matches = []
    const wordByLines = word.split('\n')
    wordByLines.forEach(wordLine => {
        if (!pattern.test(wordLine)) {
            return
        }
        const firstCharNotSpace = wordLine.match(/\S/)
        const lastSpace = wordLine.match(/\s+$/)
        const firstCharNotSpaceIndex = firstCharNotSpace.index
        let wordMatchPart = ''
        if (lastSpace) {
            wordMatchPart = wordLine.substring(firstCharNotSpaceIndex, lastSpace.index)
        } else {
            wordMatchPart = wordLine.substring(firstCharNotSpaceIndex)
        }
        matches.push(wordMatchPart)
    })

    return matches
}



module.exports = {
    localeWordPattern,
}
