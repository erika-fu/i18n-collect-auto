const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { resolveVueCompilers } = require('../myloader/vue-compiler-resolver')

function writePackage(root, name, version, marker = name) {
  const packageRoot = path.join(root, 'node_modules', ...name.split('/'))
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name,
    version,
    main: 'index.js'
  }))
  fs.writeFileSync(path.join(packageRoot, 'index.js'), `module.exports = ${JSON.stringify({ marker })}\n`)
}

function projectFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `i18n-vue-compiler-${name}-`))
  const resourcePath = path.join(root, 'src', 'App.vue')
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
  fs.writeFileSync(resourcePath, '<template />\n')
  return { root, resourcePath }
}

test('resolves the Vue 2 compiler installed by the resource owning project', () => {
  const project = projectFixture('vue2')
  writePackage(project.root, 'vue', '2.7.16')
  writePackage(project.root, 'vue-template-compiler', '2.7.16', 'vue2-compiler')

  const resolved = resolveVueCompilers({ resourcePath: project.resourcePath })

  assert.strictEqual(resolved.major, 2)
  assert.strictEqual(resolved.vueVersion, '2.7.16')
  assert.strictEqual(resolved.projectRoot, project.root)
  assert.strictEqual(resolved.templateCompiler.marker, 'vue2-compiler')
})

test('resolves the Vue 3 SFC and DOM compilers installed by the resource owning project', () => {
  const project = projectFixture('vue3')
  writePackage(project.root, 'vue', '3.5.12')
  writePackage(project.root, '@vue/compiler-sfc', '3.5.12', 'vue3-sfc')
  writePackage(project.root, '@vue/compiler-dom', '3.5.12', 'vue3-dom')

  const resolved = resolveVueCompilers({ resourcePath: project.resourcePath })

  assert.strictEqual(resolved.major, 3)
  assert.strictEqual(resolved.vueVersion, '3.5.12')
  assert.strictEqual(resolved.projectRoot, project.root)
  assert.strictEqual(resolved.compilerSfc.marker, 'vue3-sfc')
  assert.strictEqual(resolved.compilerDom.marker, 'vue3-dom')
})

test('resolves Vue 2 and Vue 3 resources independently in one monorepo', () => {
  const monorepo = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-vue-compiler-monorepo-'))
  const vue2Root = path.join(monorepo, 'packages', 'legacy')
  const vue3Root = path.join(monorepo, 'packages', 'modern')
  const vue2Resource = path.join(vue2Root, 'src', 'Legacy.vue')
  const vue3Resource = path.join(vue3Root, 'src', 'Modern.vue')
  fs.mkdirSync(path.dirname(vue2Resource), { recursive: true })
  fs.mkdirSync(path.dirname(vue3Resource), { recursive: true })
  fs.writeFileSync(vue2Resource, '<template />\n')
  fs.writeFileSync(vue3Resource, '<template />\n')
  writePackage(vue2Root, 'vue', '2.7.16')
  writePackage(vue2Root, 'vue-template-compiler', '2.7.16', 'legacy-compiler')
  writePackage(vue3Root, 'vue', '3.5.12')
  writePackage(vue3Root, '@vue/compiler-sfc', '3.5.12', 'modern-sfc')
  writePackage(vue3Root, '@vue/compiler-dom', '3.5.12', 'modern-dom')

  const legacy = resolveVueCompilers({ resourcePath: vue2Resource })
  const modern = resolveVueCompilers({ resourcePath: vue3Resource })

  assert.strictEqual(legacy.projectRoot, vue2Root)
  assert.strictEqual(legacy.templateCompiler.marker, 'legacy-compiler')
  assert.strictEqual(modern.projectRoot, vue3Root)
  assert.strictEqual(modern.compilerSfc.marker, 'modern-sfc')
  assert.strictEqual(modern.compilerDom.marker, 'modern-dom')
})

test('explicit Vue version overrides automatic compiler selection', () => {
  const project = projectFixture('override')
  writePackage(project.root, 'vue', '2.7.16')
  writePackage(project.root, '@vue/compiler-sfc', '3.5.12', 'override-sfc')
  writePackage(project.root, '@vue/compiler-dom', '3.5.12', 'override-dom')

  const resolved = resolveVueCompilers({
    resourcePath: project.resourcePath,
    vueVersion: 3
  })

  assert.strictEqual(resolved.major, 3)
  assert.strictEqual(resolved.vueVersion, '2.7.16')
  assert.strictEqual(resolved.compilerSfc.marker, 'override-sfc')
  assert.strictEqual(resolved.compilerDom.marker, 'override-dom')
})

test('rejects a Vue 2 compiler whose version does not exactly match Vue', () => {
  const project = projectFixture('vue2-mismatch')
  writePackage(project.root, 'vue', '2.7.16')
  writePackage(project.root, 'vue-template-compiler', '2.7.15')
  const vuePackagePath = path.join(project.root, 'node_modules', 'vue', 'package.json')
  const compilerPackagePath = path.join(project.root, 'node_modules', 'vue-template-compiler', 'package.json')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot use Vue 2 compiler for resource "${project.resourcePath}" (owning project "${project.root}"): ` +
          `Vue 2.7.16 at "${vuePackagePath}" does not exactly match vue-template-compiler 2.7.15 at ` +
          `"${compilerPackagePath}". Install vue-template-compiler@2.7.16 in "${project.root}".`
      )
      return true
    }
  )
})

test('reports a missing Vue installation with resource context and remediation', () => {
  const project = projectFixture('missing-vue')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot resolve Vue compiler for resource "${project.resourcePath}": no vue/package.json was found ` +
          `from "${path.dirname(project.resourcePath)}" upward. Install Vue in the resource's owning project.`
      )
      return true
    }
  )
})

test('reports a missing Vue 2 compiler package with the required exact version', () => {
  const project = projectFixture('missing-vue2-compiler')
  writePackage(project.root, 'vue', '2.7.16')
  const vuePackagePath = path.join(project.root, 'node_modules', 'vue', 'package.json')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot resolve Vue 2 compiler for resource "${project.resourcePath}" (owning project ` +
          `"${project.root}", Vue 2.7.16 at "${vuePackagePath}"): vue-template-compiler/package.json ` +
          `was not found. Install vue-template-compiler@2.7.16 in "${project.root}".`
      )
      return true
    }
  )
})

test('reports every missing Vue 3 compiler package', () => {
  const project = projectFixture('missing-vue3-compilers')
  writePackage(project.root, 'vue', '3.5.12')
  const vuePackagePath = path.join(project.root, 'node_modules', 'vue', 'package.json')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot resolve Vue 3 compilers for resource "${project.resourcePath}" (owning project ` +
          `"${project.root}", Vue 3.5.12 at "${vuePackagePath}"): @vue/compiler-sfc/package.json and ` +
          `@vue/compiler-dom/package.json were not found. Install @vue/compiler-sfc@3.5.12 and ` +
          `@vue/compiler-dom@3.5.12 in "${project.root}".`
      )
      return true
    }
  )
})

test('reports unsupported Vue majors with the discovered installation context', () => {
  const project = projectFixture('unsupported-vue')
  writePackage(project.root, 'vue', '4.0.0')
  const vuePackagePath = path.join(project.root, 'node_modules', 'vue', 'package.json')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot resolve Vue compiler for resource "${project.resourcePath}" (owning project ` +
          `"${project.root}"): Vue 4.0.0 at "${vuePackagePath}" has unsupported major 4. Supported ` +
          `majors are 2 and 3, or set loader option vueVersion to 2 or 3.`
      )
      return true
    }
  )
})

test('reports ambiguous Vue version metadata and points to the loader override', () => {
  const project = projectFixture('ambiguous-vue')
  writePackage(project.root, 'vue', 'workspace:*')
  const vuePackagePath = path.join(project.root, 'node_modules', 'vue', 'package.json')

  assert.throws(
    () => resolveVueCompilers({ resourcePath: project.resourcePath }),
    error => {
      assert.strictEqual(
        error.message,
        `Cannot determine Vue major for resource "${project.resourcePath}" (owning project ` +
          `"${project.root}"): vue/package.json at "${vuePackagePath}" has version "workspace:*". ` +
          `Set loader option vueVersion to 2 or 3.`
      )
      return true
    }
  )
})
