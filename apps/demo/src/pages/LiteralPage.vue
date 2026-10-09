<template>
  <section>
    <h2>{{ title }}</h2>
    <p>{{ `欢迎${name}回来` }}</p>
    <p>{{ greeting }}</p>
    <p>{{ `纯静态插值` }}</p>
    <p>{{ empty + '拼接后的中文' }}</p>
  </section>
</template>

<script>
export default {
  name: 'LiteralPage',
  data () {
    return {
      title: '模板字符串',
      name: '小明',
      count: 3,
      empty: ''
    }
  },
  computed: {
    greeting () {
      return `你有${this.count}条未读消息`
    }
  }
}
</script>
