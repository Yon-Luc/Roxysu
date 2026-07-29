const meta = document.getElementById("meta");
const info = window.roxysuDesktop;

if (!meta) {
  throw new Error("missing #meta");
}

if (!info) {
  meta.innerHTML = "<dt>status</dt><dd>preload missing</dd>";
} else {
  meta.innerHTML = `
    <dt>status</dt><dd>ok</dd>
    <dt>platform</dt><dd>${info.platform}</dd>
    <dt>electron</dt><dd>${info.versions.electron}</dd>
    <dt>chrome</dt><dd>${info.versions.chrome}</dd>
    <dt>node</dt><dd>${info.versions.node}</dd>
  `;
}
