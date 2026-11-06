<template>
  <main class="demo-shell">
    <section class="demo-panel">
      <p class="eyebrow">Webpack 5 + vue-loader 17</p>
      <!-- i18n-key: vue3.heading -->
      <h1>原生 Vue 三模板</h1>
      <!-- no-i18n-auto -->
      <p>内部标记不收集</p>
      <p title="保存资料">{{ scriptCopy }}</p>
      <p>{{ scriptTemplateCopy }}</p>
      <label>
        <span>{{ '插值字符串' }}</span>
        <input :placeholder="'输入' + fieldName + '名称'" aria-label="资料名称">
      </label>
      <p>{{ `欢迎${name}回来` }}</p>
      <p v-text="'普通指令不收集'"></p>
      <p>{{ $t('vue3.htmlNotice') }}</p>
      <ul class="style-formats" aria-label="Style preprocessors">
        <li class="style-format style-format--scss">SCSS</li>
        <li class="style-format style-format--sass">Sass</li>
        <li class="style-format style-format--less">Less</li>
        <li class="style-format style-format--stylus">Stylus</li>
      </ul>
    </section>
  </main>
</template>

<script>
export default {
  name: 'CollectionDemo',
  data () {
    return {
      fieldName: 'profile',
      name: 'Alex',
      scriptCopy: '脚本文案',
      scriptTemplateCopy: `脚本模板文案`
    }
  }
}
</script>

<style>
.demo-panel::after {
  content: "样式提示";
  display: block;
  margin-top: 24px;
  color: #b42318;
  font-size: 12px;
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
