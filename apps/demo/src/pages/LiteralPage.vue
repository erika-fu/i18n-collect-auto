<template>
  <section>
    <h2>{{ title }}</h2>
    <p data-role="forbidden-interpolation">{{ `欢迎${name}回来` }}</p>
    <p data-role="automatic-static">{{ `纯静态插值` }}</p>
    <p data-role="forbidden-concatenation">{{ empty + '拼接后的中文' }}</p>
    <p data-role="explicit-unread">{{ $t('demo.unread.count', { count }) }}</p>
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
  }
}
</script>
