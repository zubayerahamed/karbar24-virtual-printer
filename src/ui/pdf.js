/** Lays a receipt out in the hidden window and reports its height, so the PDF page can be exactly that long. */
window.layoutReceipt = async (job) => {
  const root = document.getElementById('receipt');
  window.renderReceipt(root, job);
  await Promise.all([...root.querySelectorAll('img')].map((image) => image.decode().catch(() => {})));
  await document.fonts.ready;
  return root.getBoundingClientRect().height;
};
