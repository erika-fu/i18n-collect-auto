<template>
  <div id="app">
    <nav class="nav">
      <button
        v-for="page in pages"
        :key="page.id"
        :class="{ active: current === page.id }"
        @click="open(page.id)"
      >{{ page.label }}</button>
    </nav>
    <component :is="currentPage" />
  </div>
</template>

<script>
import HomePage from './pages/HomePage.vue'
import ScriptPage from './pages/ScriptPage.vue'
import LiteralPage from './pages/LiteralPage.vue'
import MarkupPage from './pages/MarkupPage.vue'
import StylePage from './pages/StylePage.vue'

const pages = {
  home: HomePage,
  script: ScriptPage,
  literal: LiteralPage,
  markup: MarkupPage,
  style: StylePage
}

export default {
  name: 'App',
  data () {
    return {
      current: 'home',
      pages: [
        { id: 'home', label: '插值' },
        { id: 'script', label: '脚本字符串' },
        { id: 'literal', label: '模板字符串' },
        { id: 'markup', label: '文本与属性' },
        { id: 'style', label: '样式内容' }
      ]
    }
  },
  computed: {
    currentPage () {
      return pages[this.current]
    }
  },
  mounted () {
    this.syncFromHash()
    window.addEventListener('hashchange', this.syncFromHash)
  },
  beforeDestroy () {
    window.removeEventListener('hashchange', this.syncFromHash)
  },
  methods: {
    open (id) {
      this.current = id
      if (window.location.hash !== `#${id}`) {
        window.location.hash = id
      }
    },
    syncFromHash () {
      const id = window.location.hash.replace('#', '')
      if (pages[id]) this.current = id
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
.nav {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.nav button {
  border: 1px solid #2c3e50;
  background: #fff;
  color: #2c3e50;
  padding: 6px 12px;
  cursor: pointer;
}
.nav button.active {
  background: #2c3e50;
  color: #fff;
}
section {
  max-width: 520px;
  margin: 0 auto;
}
.content {
  width: 100%;
}
label {
  display: block;
  margin: 12px 0;
}
input {
  margin: 4px;
}
</style>
