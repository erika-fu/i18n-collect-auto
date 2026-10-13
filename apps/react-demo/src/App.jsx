const title = 'React 脚本文案'
const count = 3
const summary = `你有${count}条待处理任务`

export function App() {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p>{summary}</p>
    </main>
  )
}
