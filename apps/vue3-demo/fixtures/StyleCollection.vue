<template>
  <section>
    <h1>原生 Vue 三模板</h1>
  </section>
</template>

<script>
export default {
  name: 'StyleCollection'
}
</script>

<style>
.demo-panel::after {
  content: "样式提示";
}
</style>

<style lang="scss">
$ignored-scss-label: "SCSS 变量不收集";

.style-format--scss {
  &::after {
    content: "Vue 3 SCSS 样式";
  }
}
</style>

<style lang="sass">
$ignored-sass-label: "Sass 变量不收集"

.style-format--sass
  &::after
    content: "Vue 3 Sass 样式"
</style>

<style lang="less">
@ignored-less-label: "Less 变量不收集";

.style-format--less {
  &::after {
    content: "Vue 3 Less 样式";
  }
}
</style>

<style lang="stylus">
ignored-stylus-label = "Stylus 变量不收集"

.style-format--stylus
  &::after
    content "Vue 3 Stylus 样式"
</style>
