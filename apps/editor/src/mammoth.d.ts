declare module 'mammoth/mammoth.browser.js' {
  const mammoth: { extractRawText(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };
  export default mammoth;
}
