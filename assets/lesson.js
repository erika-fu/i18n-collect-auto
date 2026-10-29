document.addEventListener('DOMContentLoaded', () => {
  for (const button of document.querySelectorAll('[data-answer]')) {
    button.addEventListener('click', () => {
      const answer = document.getElementById(button.dataset.answer)
      if (!answer) return
      answer.classList.toggle('visible')
      button.textContent = answer.classList.contains('visible') ? '隐藏答案' : '显示答案'
    })
  }
})
