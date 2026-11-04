const fs = require('fs')
const path = require('path')

function writeProxyPackage(root, name, version, entry) {
  const packageRoot = path.join(root, 'node_modules', ...name.split('/'))
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version,
    main: 'index.js'
  }))
  fs.writeFileSync(
    path.join(packageRoot, 'index.js'),
    `module.exports = require(${JSON.stringify(entry)})\n`
  )
}

function installVue3(root) {
  const version = require('@vue/compiler-sfc/package.json').version
  const vueRoot = path.join(root, 'node_modules', 'vue')
  fs.mkdirSync(vueRoot, { recursive: true })
  fs.writeFileSync(path.join(vueRoot, 'package.json'), JSON.stringify({
    name: 'vue',
    version
  }))
  writeProxyPackage(root, '@vue/compiler-sfc', version, require.resolve('@vue/compiler-sfc'))
  writeProxyPackage(root, '@vue/compiler-dom', version, require.resolve('@vue/compiler-dom'))
}

module.exports = { installVue3 }
