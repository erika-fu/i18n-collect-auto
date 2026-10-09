<template>
  <section>
    <h2>{{ title }}</h2>
    <div ref="a" :style="{ width: `${width}px` }">{{ a }}</div>
    <div class="content">this is a long content</div>
    <div @click="change">change</div>
    <div>{{ `这是${a}的名字呀` }}</div>
    <div>{{ b }}</div>
  </section>
</template>

<script>
export default {
  name: 'HomePage',
  data () {
    return {
      title: '插值',
      a: '名字',
      b: '我不好',
      width: 10
    }
  },
  methods: {
    change () {
      this.width = 20
    }
  }
}
</script>
