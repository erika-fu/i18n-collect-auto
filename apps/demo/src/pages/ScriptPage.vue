<template>
  <section>
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <p>{{ sharedCopy }}</p>
    <p>{{ literalNote }}</p>
    <p>{{ hint }}</p>
    <button @click="save">{{ action }}</button>
    <p v-if="saved">{{ result }}</p>
  </section>
</template>

<script>
export default {
  name: 'ScriptPage',
  data () {
    return {
      title: '脚本字符串',
      message: '这是一段写在脚本里的中文',
      sharedCopy: '来自独立脚本的公共词条',
      literalNote: `公共模板${1}片段`,
      hint: /* i18n-key: demo.script.hint */ '同一句出现两次',
      action: '保存',
      result: '',
      saved: false
    }
  },
  methods: {
    save () {
      // 这是注释里的中文，不应进入收集结果
      this.result = /* i18n-key: demo.script.result */ '同一句出现两次'
      this.saved = true
    }
  }
}
</script>
