const byKey = {
  '47781b8a72bcbb7ecb1f955399a7e718': 'Welcome',
  'demo.build.localeLabel': 'The current locale can be switched',
  'demo.home.namePhrase': "{name}'s name",
  'demo.items.deleted': 'Deleted {count} items',
  'demo.markup.currentUserAria': 'Current user: {name}',
  'demo.multilingual.body': 'Hello, {name}. This page renders only through explicit localization.',
  'demo.multilingual.title': 'Runtime multilingual boundary',
  'demo.privacy.link': 'Privacy Policy',
  'demo.shared.title': 'Shared title',
  'demo.terms.link': 'Terms of Service',
  'demo.terms.notice': 'Please read {terms} and {privacy}.',
  'demo.unread.count': 'You have {count} unread messages',
  'demo.visit.banner': 'Welcome aboard',
  'demo.visit.farewell': 'Welcome back',
  'demo.wait.a': 'Please wait',
  'demo.wait.b': 'Please wait',
  'demo.welcomeBack': 'Welcome back, {name}'
}

const bySource = {
  '保存': 'Save',
  '关闭': 'Close',
  '关闭面板': 'Close panel',
  '公共模板1片段': 'Shared template 1 fragment',
  '名字': 'Name',
  '同一句出现两次': 'The same sentence appears twice',
  '姓名': 'Name',
  '姓名提示': 'Name hint',
  '小明': 'Xiaoming',
  '小红': 'Xiaohong',
  '我不好': 'I am not doing well',
  '提交按钮': 'Submit',
  '插值': 'Interpolation',
  '构建替换演示': 'Build replacement demo',
  '构建替换': 'Build replacement',
  '来自独立脚本的公共词条': 'Shared entry from a standalone script',
  '样式内容': 'Style content',
  '模板字符串': 'Template strings',
  '磁盘源码保留中文，正式 bundle 通过 localization key 渲染。':
    'The source stays in Chinese while the production bundle renders through localization keys.',
  '旁白': 'Aside',
  '收件箱': 'Inbox',
  '文本与属性': 'Text and attributes',
  '请输入姓名': 'Enter your name',
  '纯静态插值': 'Pure static interpolation',
  '脚本字符串': 'Script string',
  '这是一段写在脚本里的中文': 'This is Chinese text written in a script',
  '静态段落里的中文': 'Chinese in a static paragraph',
  '示例图片': 'Example image'
}

module.exports = require('../../../scripts/demo-translation-provider')(byKey, bySource)
