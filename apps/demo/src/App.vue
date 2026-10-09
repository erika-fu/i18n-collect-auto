<template>
  <div id="app" >
    <div ref="a" :style="{width:`${width}px`}">{{ a }}</div>
    <div class="content">this is a long content</div>
    <div @click="change">change</div>
    <div>{{ `这是${a}的名字呀` }}</div>
  </div>
</template>

<script>
export default {
  name: 'App',
  data () {
    return {
      a:"你好",
      b:"我不好",
      width:10
    }
  },
  methods:{
    change(){
      this.width = 20
    }
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
.content{
  width:100%
}
</style>
