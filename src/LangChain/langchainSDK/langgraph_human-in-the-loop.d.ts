export declare const graph_1: import("@langchain/langgraph").CompiledStateGraph<{
    draft: string;
    approved: boolean | undefined;
}, {
    draft?: string;
    approved?: boolean | undefined;
}, "__start__" | "review" | "send_email", {
    draft: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    approved: {
        (annotation: import("@langchain/langgraph").SingleReducer<boolean | undefined, boolean | undefined>): import("@langchain/langgraph").BaseChannel<boolean | undefined, boolean | import("@langchain/langgraph").OverwriteValue<boolean | undefined> | undefined, unknown>;
        (): import("@langchain/langgraph").LastValue<boolean | undefined>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
}, {
    draft: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    approved: {
        (annotation: import("@langchain/langgraph").SingleReducer<boolean | undefined, boolean | undefined>): import("@langchain/langgraph").BaseChannel<boolean | undefined, boolean | import("@langchain/langgraph").OverwriteValue<boolean | undefined> | undefined, unknown>;
        (): import("@langchain/langgraph").LastValue<boolean | undefined>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
}, import("@langchain/langgraph").StateDefinition, {
    review: {
        approved: boolean;
    };
    send_email: {};
}, unknown, unknown, []>;
