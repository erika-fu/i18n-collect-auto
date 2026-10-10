<template>
  <section>
    <h2>{{ title }}</h2>
    <p>静态段落里的中文</p>
    <label>
      姓名
      <input
        placeholder="请输入姓名"
        title="姓名提示"
        :aria-label="`当前用户${name}`"
      >
    </label>
    <img alt="示例图片" src="/favicon.ico">
    <input type="button" value="提交按钮">
    <button aria-label="关闭面板">关闭</button>
    <span data-note="不要收集属性">旁白</span>
  </section>
</template>

<script>
export default {
  name: 'MarkupPage',
  data () {
    return {
      title: '文本与属性',
      name: '小红'
    }
  }
}
</script>
