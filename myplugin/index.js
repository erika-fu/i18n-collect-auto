const { createFile } = require('../mycommon/collect')
const { resolve } = require('path')

class MyI18nPlugin {
    constructor(options = {}) {
        this.options = options
    }

    apply(compiler) {
        console.log('✓ MyI18nPlugin 已初始化')
        console.log('  输出文件:', resolve(this.options.output.path, this.options.output.filename))
        // 在编译完成后执行 同步注册done钩子
        this.hook(compiler, 'done', 'tap', () => {
            console.log('\n✓ 编译完成，开始生成国际化配置文件...')
            // 写入文件
            createFile(this.options.output.path, this.options.output.filename)
        })
    }

    /**
     * 添加钩子
     */
    hook(target, name, method, cb) {
        if (target.hooks) {
            target.hooks[name][method]('MyI18nPlugin', cb)
        } else {
            target.plugin(name, cb)
        }
    }
}

module.exports = MyI18nPlugin
