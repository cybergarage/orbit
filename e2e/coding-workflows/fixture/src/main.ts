import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("Application root was not found.");
}

app.innerHTML = `
  <section class="starter">
    <p class="eyebrow">AI CODING BOOK</p>
    <h1>Starter Project</h1>
    <p>Start here and build the game with a coding agent.</p>
  </section>
`;
