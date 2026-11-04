const fs = require('fs')
const path = require('path')

function installVue2(root) {
  const vuePackage = require('vue/package.json')
  const compilerPackage = require('vue-template-compiler/package.json')
  const vueRoot = path.join(root, 'node_modules/vue')
  const compilerRoot = path.join(root, 'node_modules/vue-template-compiler')
  fs.mkdirSync(vueRoot, { recursive: true })
  fs.mkdirSync(compilerRoot, { recursive: true })
  fs.writeFileSync(path.join(vueRoot, 'package.json'), JSON.stringify({
    name: 'vue',
    version: vuePackage.version
  }))
  fs.writeFileSync(path.join(compilerRoot, 'package.json'), JSON.stringify({
    name: 'vue-template-compiler',
    version: compilerPackage.version,
    main: 'index.js'
  }))
  fs.writeFileSync(
    path.join(compilerRoot, 'index.js'),
    `module.exports = require(${JSON.stringify(require.resolve('vue-template-compiler'))})\n`
  )
}

module.exports = { installVue2 }
