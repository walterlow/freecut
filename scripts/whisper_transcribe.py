import sys
import json
import argparse
import os

def main():
    parser = argparse.ArgumentParser(description="FreeCut On-Demand Faster-Whisper Transcriber")
    parser.add_argument("--audio", required=True, help="Path to input audio file")
    parser.add_argument("--model", default="large-v3-turbo", help="Whisper model (large-v3, large-v3-turbo, turbo, medium, small, base, tiny)")
    parser.add_argument("--language", default=None, help="Language code or 'auto'")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"], help="Compute device")
    parser.add_argument("--compute_type", default="auto", help="Compute type (float16, int8, auto)")
    parser.add_argument("--output", default=None, help="Path to output JSON file")
    args = parser.parse_args()

    import ctranslate2
    from faster_whisper import WhisperModel

    device = args.device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"

    compute_type = args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    lang = args.language
    if lang in ["auto", "", "None", None]:
        lang = None

    # Map model name
    raw_model = (args.model or "large-v3-turbo").lower().strip()
    if raw_model in ["large-v3", "whisper-large-v3", "large_v3"]:
        model_name = "large-v3"
    elif raw_model in ["turbo", "large-v3-turbo", "whisper-large-v3-turbo"]:
        model_name = "large-v3-turbo"
    elif raw_model in ["medium", "small", "base", "tiny"]:
        model_name = raw_model
    else:
        model_name = args.model

    sys.stderr.write(f"[FreeCut Whisper] Loading model '{model_name}' on {device.upper()} ({compute_type})...\n")
    sys.stderr.flush()

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:
        sys.stderr.write(f"[FreeCut Whisper] Error loading model: {e}\n")
        sys.stderr.flush()
        sys.exit(1)

    sys.stderr.write(f"[FreeCut Whisper] Starting transcription of '{args.audio}' (language: {lang or 'auto'})...\n")
    sys.stderr.flush()

    try:
        segments_gen, info = model.transcribe(
            args.audio,
            language=lang,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        results = []
        for segment in segments_gen:
            words = []
            if segment.words:
                for w in segment.words:
                    clean_word = w.word.strip()
                    if clean_word:
                        words.append({
                            "word": clean_word,
                            "start": round(w.start, 3),
                            "end": round(w.end, 3),
                            "probability": round(w.probability, 3)
                        })
            clean_text = segment.text.strip()
            if clean_text:
                results.append({
                    "id": segment.id,
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "text": clean_text,
                    "words": words
                })

        payload = {
            "language": info.language,
            "language_probability": round(info.language_probability, 3) if info.language_probability else 1.0,
            "duration": round(info.duration, 3) if info.duration else 0.0,
            "segments": results
        }

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            sys.stderr.write(f"[FreeCut Whisper] Transcription completed and saved to {args.output}\n")
        else:
            print("---FREECUT_WHISPER_START---")
            print(json.dumps(payload, ensure_ascii=False))
            print("---FREECUT_WHISPER_END---")
            sys.stdout.flush()

    except Exception as e:
        sys.stderr.write(f"[FreeCut Whisper] Transcription error: {e}\n")
        sys.stderr.flush()
        sys.exit(1)

if __name__ == "__main__":
    main()
