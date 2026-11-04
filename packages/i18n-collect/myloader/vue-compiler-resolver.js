const fs = require('fs')
const path = require('path')

function packagePath(projectRoot, packageName) {
  return path.join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json')
}

function findInstalledPackage(startDirectory, packageName) {
  let directory = path.resolve(startDirectory)
  while (true) {
    const candidate = packagePath(directory, packageName)
    if (fs.existsSync(candidate)) return { packagePath: candidate, projectRoot: directory }
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

function readPackage(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function resolveModule(projectRoot, packageName) {
  const entry = require.resolve(packageName, { paths: [projectRoot] })
  return require(entry)
}

function joined(items) {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function resolveVueCompilers({ resourcePath, vueVersion } = {}) {
  const resource = path.resolve(resourcePath)
  const resourceDirectory = path.dirname(resource)
  const vue = findInstalledPackage(resourceDirectory, 'vue')
  if (!vue) {
    throw new Error(
      `Cannot resolve Vue compiler for resource "${resource}": no vue/package.json was found ` +
      `from "${resourceDirectory}" upward. Install Vue in the resource's owning project.`
    )
  }
  const vuePackage = readPackage(vue.packagePath)
  if (vueVersion !== undefined && vueVersion !== null && vueVersion !== 2 && vueVersion !== 3) {
    throw new Error('vueVersion must be 2 or 3')
  }
  const version = String(vuePackage.version)
  const match = /^(\d+)(?:\.|$)/.exec(version)
  if (vueVersion == null && !match) {
    throw new Error(
      `Cannot determine Vue major for resource "${resource}" (owning project "${vue.projectRoot}"): ` +
      `vue/package.json at "${vue.packagePath}" has version "${version}". ` +
      'Set loader option vueVersion to 2 or 3.'
    )
  }
  const major = vueVersion == null ? Number(match[1]) : vueVersion

  if (major === 2) {
    const compiler = findInstalledPackage(vue.projectRoot, 'vue-template-compiler')
    if (!compiler) {
      throw new Error(
        `Cannot resolve Vue 2 compiler for resource "${resource}" (owning project ` +
        `"${vue.projectRoot}", Vue ${vuePackage.version} at "${vue.packagePath}"): ` +
        `vue-template-compiler/package.json was not found. Install ` +
        `vue-template-compiler@${vuePackage.version} in "${vue.projectRoot}".`
      )
    }
    const compilerPackage = readPackage(compiler.packagePath)
    if (compilerPackage.version !== vuePackage.version) {
      throw new Error(
        `Cannot use Vue 2 compiler for resource "${resource}" (owning project "${vue.projectRoot}"): ` +
        `Vue ${vuePackage.version} at "${vue.packagePath}" does not exactly match ` +
        `vue-template-compiler ${compilerPackage.version} at "${compiler.packagePath}". ` +
        `Install vue-template-compiler@${vuePackage.version} in "${vue.projectRoot}".`
      )
    }
    return {
      major,
      vueVersion: vuePackage.version,
      projectRoot: vue.projectRoot,
      vuePackagePath: vue.packagePath,
      templateCompiler: resolveModule(vue.projectRoot, 'vue-template-compiler')
    }
  }
  if (major === 3) {
    const compilerNames = ['@vue/compiler-sfc', '@vue/compiler-dom']
    const missing = compilerNames.filter(name => !findInstalledPackage(vue.projectRoot, name))
    if (missing.length > 0) {
      const packages = missing.map(name => `${name}/package.json`)
      const installs = missing.map(name => `${name}@${vuePackage.version}`)
      const verb = missing.length === 1 ? 'was' : 'were'
      throw new Error(
        `Cannot resolve Vue 3 compilers for resource "${resource}" (owning project ` +
        `"${vue.projectRoot}", Vue ${vuePackage.version} at "${vue.packagePath}"): ` +
        `${joined(packages)} ${verb} not found. Install ${joined(installs)} in "${vue.projectRoot}".`
      )
    }
    return {
      major,
      vueVersion: vuePackage.version,
      projectRoot: vue.projectRoot,
      vuePackagePath: vue.packagePath,
      compilerSfc: resolveModule(vue.projectRoot, '@vue/compiler-sfc'),
      compilerDom: resolveModule(vue.projectRoot, '@vue/compiler-dom')
    }
  }
  throw new Error(
    `Cannot resolve Vue compiler for resource "${resource}" (owning project "${vue.projectRoot}"): ` +
    `Vue ${vuePackage.version} at "${vue.packagePath}" has unsupported major ${major}. ` +
    'Supported majors are 2 and 3, or set loader option vueVersion to 2 or 3.'
  )
}

module.exports = { resolveVueCompilers }
