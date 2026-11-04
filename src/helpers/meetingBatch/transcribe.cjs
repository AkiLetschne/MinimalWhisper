// Shared executor for file uploads and meeting segments. Callers choose the path policy.
module.exports = async function transcribeFile(event, OPTIONS, deps) {
  const {
    resolvePath,
    prepareProviderUpload,
    transcriptionProviderBaseUrls,
    transcriptionProviderName,
    byokSizeCapError,
    providerContentType,
    buildMultipartBody,
    postMultipart,
    debugLogger,
    redactProviderBody,
    providerHttpError,
    providerError,
    PROVIDER_ERROR_CODES,
    transcribeWithTinfoil,
    transcribeWithGemini,
    diarizationHost,
    timestampRequestFields,
    mapVerboseSegments,
    formatDiarTime,
    asProviderError,
    ipcErrorFields,
    MISTRAL_TRANSCRIPTION_URL,
    XAI_STT_URL,
    environmentManager,
    executeManagedTranscription,
    signal,
  } = deps;
  const {
    filePath,
    apiKey,
    baseUrl,
    model,
    diarize,
    timestamps,
    provider,
    language,
    environment,
    tenant,
    transcriptionMode,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
    managed,
    prompt,
    meetingLanguage,
  } = OPTIONS;
  const fs = require("fs");
  const path = require("path");
  let cleanupUpload = null;
  let providerErrorContext = null;
  try {
    if (meetingLanguage && ![undefined, "providers", "self-hosted"].includes(transcriptionMode)) {
      return {
        success: false,
        error:
          "This transcription mode is not supported for meetings. Choose a cloud provider or self-hosted service.",
        messageKey: "meetings.unsupportedTranscriptionMode",
      };
    }
    if (typeof filePath !== "string") {
      return { success: false, error: "Invalid file path" };
    }
    const sourcePath = resolvePath(filePath);
    if (!sourcePath) return { success: false, error: "File path not allowed" };

    const { resolveTranscriptionRoute } = await import("../transcriptionRoute.ts");
    const route = resolveTranscriptionRoute({
      settings: {
        transcriptionMode,
        remoteTranscriptionUrl,
        remoteTranscriptionModel,
        cloudTranscriptionProvider: provider,
        cloudTranscriptionModel: model,
        cloudTranscriptionBaseUrl: baseUrl,
        cortiEnvironment: environment,
        cortiTenant: tenant,
        ...(meetingLanguage ? { preferredLanguage: language } : {}),
      },
      providers: transcriptionProviderBaseUrls(),
      managed,
      prompt,
      meetingLanguage,
      request: meetingLanguage ? {} : { effectiveLanguage: language || undefined },
    });

    // Fail closed: a misconfigured route must never fall through to a default.
    if (route.transport === "error" || route.transport === "local") {
      if (route.transport === "local") {
        return {
          success: false,
          error:
            "This transcription mode is not supported for meetings. Choose a cloud provider or self-hosted service.",
          messageKey: "meetings.unsupportedTranscriptionMode",
        };
      }
      return {
        success: false,
        error: route.message,
        code: route.code,
        messageKey: route.messageKey,
      };
    }

    const upload = await prepareProviderUpload(sourcePath, { signal });
    cleanupUpload = upload.cleanup;
    const realByok = upload.path;

    if (route.transport === "managed") {
      if (fs.statSync(realByok).size > route.sizeCapBytes) {
        return { success: false, error: byokSizeCapError(route.sizeCapBytes) };
      }
      const text = await executeManagedTranscription(event, route, {
        audioBuffer: fs.readFileSync(realByok),
        fileName: path.basename(realByok),
        contentType: providerContentType(realByok),
        signal,
      });
      return { success: true, text };
    }

    // Every branch below calls a BYOK provider or the user's own server.
    providerErrorContext = {
      provider: transcriptionProviderName(route.provider),
      selfHosted: route.provider === "self-hosted" || route.provider === "custom",
      model: route.model,
      surface: "transcription",
    };

    if (route.transport === "http-batch" && route.provider === "self-hosted") {
      // User's own server, so the 25 MB third-party cap does not apply.
      const { body, boundary } = buildMultipartBody(
        fs.readFileSync(realByok),
        path.basename(realByok),
        providerContentType(realByok),
        { model: route.model, language: route.language }
      );
      const data = await postMultipart(new URL(route.endpoint), body, boundary, undefined, {
        signal,
      });
      if (data.statusCode !== 200) {
        debugLogger.warn("Self-hosted file transcription failed", {
          status: data.statusCode,
          body: redactProviderBody(data.data),
        });
        throw providerHttpError({
          ...providerErrorContext,
          status: data.statusCode,
          body: data.data,
        });
      }
      return { success: true, text: data.data.text };
    }

    const fileSize = fs.statSync(realByok).size;
    if (route.sizeCapBytes && fileSize > route.sizeCapBytes) {
      return { success: false, error: byokSizeCapError(route.sizeCapBytes) };
    }

    if (route.transport === "proxied" && route.provider === "corti") {
      const clientId = environmentManager.getCortiClientId();
      const clientSecret = environmentManager.getCortiClientSecret();
      if (!clientId || !clientSecret) {
        throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
          provider: "Corti",
          surface: "transcription",
        });
      }
      const { transcribeAudio } = require("../cortiTranscription");
      const { text } = await transcribeAudio({
        environment: route.cortiEnvironment,
        tenant: route.cortiTenant,
        clientId,
        clientSecret,
        audioBuffer: fs.readFileSync(realByok),
        language: route.language,
        signal,
      });
      return { success: true, text };
    }

    if (route.transport === "proxied" && route.provider === "tinfoil") {
      const { text } = await transcribeWithTinfoil({
        audioBuffer: fs.readFileSync(realByok),
        fileName: path.basename(realByok),
        contentType: providerContentType(realByok),
        language: route.language,
        apiKey: environmentManager.getTinfoilKey(),
        signal,
      });
      return { success: true, text };
    }

    if (route.transport === "proxied" && route.provider === "gemini") {
      // Deliberately no language hint — same rationale as the multipart
      // branch below, and Gemini's language_codes is a hard constraint.
      const { text } = await transcribeWithGemini({
        audioBuffer: fs.readFileSync(realByok),
        model: route.model,
        contentType: providerContentType(realByok),
        apiKey: apiKey || environmentManager.getGeminiKey(),
        signal,
      });
      return { success: true, text };
    }

    if (!apiKey && route.provider !== "custom") {
      throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
        provider: transcriptionProviderName(route.provider),
        surface: "transcription",
      });
    }

    const audioBuffer = fs.readFileSync(realByok);
    const contentType = providerContentType(realByok);
    const fileName = path.basename(realByok);

    // mistral/xai have no OpenAI-compatible endpoint — talk to them
    // directly; everything else consumes the route endpoint as-is.
    let transcriptionUrl;
    const multipartFields = {};
    if (route.provider === "xai") {
      transcriptionUrl = XAI_STT_URL;
      // xAI STT accepts no model field; the route pre-filters language
      if (route.language) {
        multipartFields.language = route.language;
        multipartFields.format = "true";
      }
    } else {
      transcriptionUrl = route.provider === "mistral" ? MISTRAL_TRANSCRIPTION_URL : route.endpoint;
      multipartFields.model = route.model;
      // No language field: an uploaded file is often not in the dictation
      // language, and a wrong hint silently mistranscribes it. Providers
      // that require one (Corti) are handled on their own branch above.
    }

    if (meetingLanguage && route.language && route.provider !== "custom")
      multipartFields.language = route.language;
    if (prompt) {
      const { shouldSendWhisperPrompt } = await import("../sttWhisperPrompt.js");
      if (shouldSendWhisperPrompt(route.provider, route.model)) {
        const { usesTranscriptionKeywords, dictionaryKeywords, dictionaryKeywordOverflow } =
          await import("../../utils/dictionaryKeywords.js");
        const { dictionaryPromptLimit, trimDictionaryPrompt } =
          await import("../../utils/dictionaryPromptCap.js");
        const usesKeywords = usesTranscriptionKeywords(route.model);
        const input = usesKeywords ? dictionaryKeywordOverflow(prompt) : prompt;
        const trimmed = trimDictionaryPrompt(
          input,
          dictionaryPromptLimit({
            provider: route.provider,
            endpoint: transcriptionUrl,
            model: route.model,
          })
        ).prompt;
        if (trimmed) multipartFields.prompt = trimmed;
        if (usesKeywords) multipartFields["keywords[]"] = dictionaryKeywords(prompt);
      }
    }

    if (diarize) {
      // A Custom endpoint may front OpenAI or Mistral, so fall back to the
      // resolved host before giving up on speaker labels.
      const diarizeTarget =
        route.provider === "custom" ? diarizationHost(route.endpoint) : route.provider;
      if (diarizeTarget === "mistral") {
        multipartFields.diarize = "true";
        multipartFields.timestamp_granularities = "segment";
      } else if (diarizeTarget === "openai") {
        multipartFields.model = "gpt-4o-transcribe-diarize";
        // Speaker annotations require diarized_json; verbose_json is not supported by this model.
        multipartFields.response_format = "diarized_json";
        multipartFields.chunking_strategy = "auto";
      } else {
        // Degrade to a plain transcript, never fail the upload.
        debugLogger.warn(
          "BYOK diarization requested but provider is not OpenAI/Mistral; transcribing without speakers",
          { provider: route.provider, endpoint: route.endpoint }
        );
      }
    } else if (timestamps) {
      // Providers/models that don't support the request keep the
      // plain-text request untouched (helper returns null).
      const fields = timestampRequestFields(route.provider, route.model);
      if (fields) Object.assign(multipartFields, fields);
    }

    const { body, boundary } = buildMultipartBody(
      audioBuffer,
      fileName,
      contentType,
      multipartFields
    );

    const url = new URL(transcriptionUrl);
    // Mistral authenticates with x-api-key, not Bearer.
    const headers = apiKey
      ? route.provider === "mistral"
        ? { "x-api-key": apiKey }
        : route.transport === "http-batch" && route.auth.scheme === "azure-api-key"
          ? { "api-key": apiKey }
          : { Authorization: `Bearer ${apiKey}` }
      : undefined;
    const data = await postMultipart(url, body, boundary, headers, { signal });

    if (data.statusCode !== 200) {
      debugLogger.warn("BYOK file transcription failed", {
        provider: route.provider,
        status: data.statusCode,
        body: redactProviderBody(data.data),
      });
      throw providerHttpError({
        ...providerErrorContext,
        status: data.statusCode,
        body: data.data,
      });
    }

    if (diarize && data.data?.speakers) {
      const segments = (data.data.speakers || []).map((s) => ({
        speaker: s.id || `Speaker ${s.speaker || "?"}`,
        text: s.text || "",
        start: s.start || 0,
        end: s.end || 0,
      }));
      const formatted = segments
        .map(
          (s) => `[${s.speaker}] ${formatDiarTime(s.start)} - ${formatDiarTime(s.end)}\n${s.text}`
        )
        .join("\n\n");
      return { success: true, text: formatted, diarized: true, segments };
    }

    if (diarize && data.data?.segments) {
      const segments = (data.data.segments || []).map((s) => ({
        speaker: s.speaker || "Speaker ?",
        text: s.text || "",
        start: s.start || 0,
        end: s.end || 0,
      }));
      const formatted = segments
        .map(
          (s) => `[${s.speaker}] ${formatDiarTime(s.start)} - ${formatDiarTime(s.end)}\n${s.text}`
        )
        .join("\n\n");
      return { success: true, text: formatted, diarized: true, segments };
    }

    if (diarize) {
      debugLogger.warn("BYOK diarization requested but provider returned no speaker data");
    }
    const segments = timestamps ? mapVerboseSegments(data.data) : null;
    return { success: true, text: data.data.text, ...(segments ? { segments } : {}) };
  } catch (rawError) {
    const error = providerErrorContext ? asProviderError(rawError, providerErrorContext) : rawError;
    debugLogger.error("BYOK audio file transcription error", { error: error.message });
    return { success: false, ...ipcErrorFields(error) };
  } finally {
    cleanupUpload?.();
  }
};
