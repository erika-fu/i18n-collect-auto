const byKey = {
  'vue3.build.localeLabel': 'The current locale can be switched',
  'vue3.fieldPlaceholder': 'Enter the {field} name',
  'vue3.htmlNotice': 'Localized with Vue I18n',
  'vue3.welcomeBack': 'Welcome back, {name}'
}

const bySource = {
  '保存资料': 'Save profile',
  '原生 Vue 三模板': 'Native Vue 3 template',
  '构建替换演示': 'Build replacement demo',
  '磁盘源码保留中文，正式 bundle 通过 localization key 渲染。':
    'The source stays in Chinese while the production bundle renders through localization keys.',
  '插值字符串': 'Interpolated string',
  '脚本文案': 'Script copy',
  '脚本模板文案': 'Script template copy',
  '资料名称': 'Profile name'
}

module.exports = require('../../../scripts/demo-translation-provider')(byKey, bySource)
