<template>
  <section>
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <p>{{ sharedCopy }}</p>
    <p>{{ hint }}</p>
    <button @click="save">{{ action }}</button>
    <p v-if="saved">{{ result }}</p>
  </section>
</template>

<script>
import { sharedCopy } from '../copy'

export default {
  name: 'ScriptPage',
  data () {
    return {
      title: '脚本字符串',
      message: '这是一段写在脚本里的中文',
      sharedCopy,
      hint: '同一句出现两次',
      action: '保存',
      result: '',
      saved: false
    }
  },
  methods: {
    save () {
      // 这是注释里的中文，不应进入收集结果
      this.result = '同一句出现两次'
      this.saved = true
    }
  }
}
</script>
