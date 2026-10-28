const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Text with its XML entities (`&amp;`, `&#38;`, `&#x26;`) decoded in one pass, as NuGet reads a config file */
export const decodeXml = (value: string) => value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_all, dec, hex, name) =>
    name ? XML_ENTITIES[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)));

/** The value of an attribute of an element's text, in double or single quotes, decoded; undefined when it has none */
export const xmlAttribute = (element: string, name: string) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(element);
    return match ? decodeXml(match[1] ?? match[2]) : undefined;
};
