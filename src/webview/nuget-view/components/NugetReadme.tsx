import { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { readmeElement } from "../readmeSafety";

interface NugetReadmeProps {
    packageId: string;
    version: string;
    readmeUrl?: string;
}

export default function NugetReadme({ packageId, version, readmeUrl }: NugetReadmeProps) {
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // The answer of an earlier package must not replace the README of the one selected since
        let current = true;
        const controller = new AbortController();

        setError(null);
        if (!readmeUrl) {
            setLoading(false);
            setText("No README available for this package.");
            return () => controller.abort();
        }

        setLoading(true);

        fetch(readmeUrl, { signal: controller.signal })
            .then(res => {
                if (res.ok) {
                    return res.text();
                } else if (res.status === 404) {
                    return "No README found for this package.";
                } else {
                    throw new Error(`Failed to fetch README: ${res.status}`);
                }
            })
            .then((content) => {
                if (current) {
                    setText(content);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (current) {
                    setError(err.message);
                    setText("Failed to load README.");
                    setLoading(false);
                }
            });

        return () => {
            current = false;
            controller.abort();
        };
    }, [packageId, version, readmeUrl]);

    if (loading) {
        return (
            <div style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--vscode-descriptionForeground)'
            }}>
                Loading README...
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                padding: '16px',
                color: 'var(--vscode-errorForeground)'
            }}>
                Error: {error}
            </div>
        );
    }

    return (
        <div style={{
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: 'var(--vscode-foreground)'
        }}>
            <Markdown
                options={{
                    // The README is written by the package author: no forms, no <base>, no positioning
                    createElement: readmeElement as never,
                    overrides: {
                        // Style markdown elements to match VS Code theme
                        h1: {
                            props: {
                                style: {
                                    fontSize: '18px',
                                    fontWeight: 'bold',
                                    marginBottom: '12px',
                                    borderBottom: '1px solid var(--vscode-panel-border)',
                                    paddingBottom: '4px'
                                }
                            }
                        },
                        h2: {
                            props: {
                                style: {
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    marginBottom: '10px',
                                    marginTop: '16px'
                                }
                            }
                        },
                        h3: {
                            props: {
                                style: {
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    marginBottom: '8px',
                                    marginTop: '12px'
                                }
                            }
                        },
                        code: {
                            props: {
                                style: {
                                    backgroundColor: 'var(--vscode-textCodeBlock-background)',
                                    padding: '2px 4px',
                                    borderRadius: '2px',
                                    fontSize: '12px',
                                    fontFamily: 'var(--vscode-editor-font-family)'
                                }
                            }
                        },
                        pre: {
                            props: {
                                style: {
                                    backgroundColor: 'var(--vscode-textCodeBlock-background)',
                                    padding: '12px',
                                    borderRadius: '4px',
                                    overflow: 'auto',
                                    fontSize: '12px',
                                    fontFamily: 'var(--vscode-editor-font-family)',
                                    margin: '8px 0'
                                }
                            }
                        },
                        a: {
                            props: {
                                style: {
                                    color: 'var(--vscode-textLink-foreground)',
                                    textDecoration: 'none'
                                }
                            }
                        },
                        ul: {
                            props: {
                                style: {
                                    paddingLeft: '20px',
                                    margin: '8px 0'
                                }
                            }
                        },
                        ol: {
                            props: {
                                style: {
                                    paddingLeft: '20px',
                                    margin: '8px 0'
                                }
                            }
                        },
                        p: {
                            props: {
                                style: {
                                    margin: '8px 0'
                                }
                            }
                        }
                    }
                }}
            >
                {text}
            </Markdown>
        </div>
    );
}