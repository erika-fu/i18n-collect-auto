<template>
  <main class="demo-shell">
    <section class="demo-panel">
      <p class="eyebrow">Webpack 5 + vue-loader 17</p>
      <!-- i18n-key: vue3.heading -->
      <h1>原生 Vue 三模板</h1>
      <!-- no-i18n-auto -->
      <p>内部标记不收集</p>
      <p title="保存资料">{{ scriptCopy }}</p>
      <label>
        <span>{{ '插值字符串' }}</span>
        <input :placeholder="'输入' + fieldName + '名称'" aria-label="资料名称">
      </label>
      <p>{{ `欢迎${name}回来` }}</p>
      <p v-text="'指令文案'"></p>
      <p>{{ $t('vue3.htmlNotice') }}</p>
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
      scriptCopy: '脚本文案'
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
