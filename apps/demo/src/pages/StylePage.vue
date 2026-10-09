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

<style>
.badge::after {
  content: "（新）";
  margin-left: 4px;
}
</style>
