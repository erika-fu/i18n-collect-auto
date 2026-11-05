<template>
  <section>
    <h2>{{ title }}</h2>
    <p class="badge">收件箱</p>
  </section>
</template>

<script>
export default {
  name: 'StylePage',
  data () {
    return {
      title: '样式内容'
    }
  }
}
</script>

<style lang="sass">
$badge-color: #2c3e50

.badge
  color: $badge-color

  &::after
    content: "（Sass 新）"
    margin-left: 4px

  /* 注释不收集 */
  --label: "变量不收集"
</style>
