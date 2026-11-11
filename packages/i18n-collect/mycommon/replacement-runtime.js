const fs = require('fs')
const path = require('path')
const { SCRIPT_EXTENSIONS, exportsLocalizationFunction, runtimeCalls } = require('./replace-preview')

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage'])
const RUNTIME = {
  vue2: 'vue2 adapter requires vue-i18n 8 in package.json and an existing Vue.use(VueI18n) or new VueI18n(...) call. This command does not install dependencies or rewrite application bootstrap.',
  vue3: 'vue3 adapter requires vue-i18n 9 or newer in package.json and an existing createI18n(...) call. This command does not install dependencies or rewrite application bootstrap.',
  js: 'js adapter requires an existing module that exports a localization function named t. This command does not rewrite application bootstrap.'
}

function walkFiles(directory, files) {
  let names
  try {
    names = fs.readdirSync(directory)
  } catch (error) {
    return
  }
  for (const name of names) {
    if (SKIP_DIRECTORIES.has(name)) continue
    const full = path.join(directory, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch (error) {
      continue
    }
    if (stat.isDirectory()) walkFiles(full, files)
    else files.push(full)
  }
}

function majorVersion(spec) {
  const match = String(spec || '').match(/\d+/)
  return match ? Number(match[0]) : null
}

function packageVersion(root, name) {
  const file = path.join(root, 'package.json')
  if (!fs.existsSync(file)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
    return deps[name] || null
  } catch (error) {
    return null
  }
}

function sourceText(file) {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.vue') {
    const match = fs.readFileSync(file, 'utf8').match(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/i)
    return match ? match[2] : ''
  }
  if (SCRIPT_EXTENSIONS.has(extension)) return fs.readFileSync(file, 'utf8')
  return null
}

function projectRuntime(root) {
  const found = { vue2: false, vue3: false }
  const files = []
  walkFiles(root, files)
  for (const file of files) {
    const text = sourceText(file)
    if (!text || !text.trim()) continue
    const calls = runtimeCalls(text)
    found.vue2 = found.vue2 || calls.vue2
    found.vue3 = found.vue3 || calls.vue3
  }
  return found
}

function projectExportsT(root) {
  const files = []
  walkFiles(root, files)
  return files.some(file => {
    const text = sourceText(file)
    if (text == null || !/\bt\b/.test(text)) return false
    return exportsLocalizationFunction(text)
  })
}

function assertReplacementRuntime(root, adapter) {
  if (adapter === 'js') {
    if (!projectExportsT(root)) {
      const error = new Error(RUNTIME.js)
      error.kind = 'configuration'
      throw error
    }
    return { adapter, localizationFunction: true }
  }
  const version = majorVersion(packageVersion(root, 'vue-i18n'))
  const runtime = projectRuntime(root)
  if (adapter === 'vue2') {
    if (version !== 8 || !runtime.vue2) {
      const error = new Error(RUNTIME.vue2)
      error.kind = 'configuration'
      throw error
    }
    return { adapter, localizationFunction: true, vueVersion: 2 }
  }
  if (version == null || version < 9 || !runtime.vue3) {
    const error = new Error(RUNTIME.vue3)
    error.kind = 'configuration'
    throw error
  }
  return { adapter, localizationFunction: true, vueVersion: 3 }
}

module.exports = {
  RUNTIME,
  assertReplacementRuntime
}
