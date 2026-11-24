declare module 'pdfmake/build/pdfmake' {
  const pdfMake: {
    vfs: Record<string, string>;
    createPdf: (definition: unknown) => unknown;
  };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const fonts: unknown;
  export default fonts;
}
