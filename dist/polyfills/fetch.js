// @ts-ignore
import { TextDecoder, TextEncoder } from "text-encoding";
import { ReadableStream, TransformStream, WritableStream, } from "web-streams-polyfill";
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
// @ts-ignore
global.ReadableStream = ReadableStream;
// @ts-ignore
global.TransformStream = TransformStream;
global.WritableStream = WritableStream;
import { fetch as rnFetch, Headers, Request, Response,
// @ts-ignore
 } from "react-native-fetch-api";
export const polyfill = () => {
    const fetch = (input, init) => rnFetch(input, {
        ...init,
        reactNative: { textStreaming: true },
        credentials: "include",
    });
    global.fetch = fetch;
    global.Headers = Headers;
    global.Request = Request;
    global.Response = Response;
};
//# sourceMappingURL=fetch.js.map