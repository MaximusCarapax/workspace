#!/usr/bin/env node
/**
 * Image Generation via OpenRouter
 * Uses Gemini 2.5 Flash Image (Nano Banana) by default
 * 
 * Usage:
 *   node tools/image-gen.js "a cat wearing a top hat"
 *   node tools/image-gen.js "prompt" --model pro
 *   node tools/image-gen.js "prompt" --output cat.png
 */

const fs = require('fs');
const path = require('path');

const MODELS = {
  'flash': 'google/gemini-2.5-flash-image',      // cheapest
  'pro': 'google/gemini-3-pro-image-preview',    // good balance
  'gpt-mini': 'openai/gpt-5-image-mini',         // mid-tier
  'gpt': 'openai/gpt-5-image'                    // best quality
};

// Default to quality for social media content
const DEFAULT_MODEL = 'gpt';

async function generateImage(prompt, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY || 
    JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/openrouter.json'))).api_key;
  
  const model = MODELS[options.model] || MODELS['flash'];
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://openclaw.ai',
      'X-Title': 'OpenClaw Image Gen'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: `Generate an image: ${prompt}`
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Image Generation Tool (OpenRouter)

Usage:
  node image-gen.js "your prompt here"
  node image-gen.js "prompt" --model pro
  node image-gen.js "prompt" --output image.png

Models:
  gpt      - GPT-5 Image (default, best quality)
  gpt-mini - GPT-5 Image Mini (good quality, cheaper)
  pro      - Gemini 3 Pro Image (great quality)
  flash    - Gemini 2.5 Flash Image (cheapest, for bulk)

Examples:
  node image-gen.js "a cyberpunk cityscape at sunset"
  node image-gen.js "minimalist logo for a tech startup" --model pro
`);
    return;
  }

  const prompt = args[0];
  let model = DEFAULT_MODEL;
  let output = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--model' && args[i+1]) {
      model = args[++i];
    } else if (args[i] === '--output' && args[i+1]) {
      output = args[++i];
    }
  }

  console.log(`Generating image with ${model} model...`);
  console.log(`Prompt: "${prompt}"`);
  
  try {
    const result = await generateImage(prompt, { model });
    
    // Check for images in the response (OpenRouter format)
    const message = result.choices?.[0]?.message;
    const images = message?.images;
    
    if (images && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const url = img.image_url?.url || img.url;
        
        if (url && url.startsWith('data:image')) {
          // Base64 encoded image
          const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1];
            const base64Data = matches[2];
            const filename = output || `image_${Date.now()}${i > 0 ? `_${i}` : ''}.${ext}`;
            fs.writeFileSync(filename, Buffer.from(base64Data, 'base64'));
            console.log(`✓ Image saved to: ${filename}`);
          }
        } else if (url && url.startsWith('http')) {
          console.log(`✓ Image URL: ${url}`);
        }
      }
    } else if (message?.content) {
      // Fallback: check content for image data
      const content = message.content;
      if (content.startsWith('data:image')) {
        const matches = content.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1];
          const base64Data = matches[2];
          const filename = output || `image_${Date.now()}.${ext}`;
          fs.writeFileSync(filename, Buffer.from(base64Data, 'base64'));
          console.log(`✓ Image saved to: ${filename}`);
        }
      } else if (content.startsWith('http')) {
        console.log(`✓ Image URL: ${content}`);
      } else if (content) {
        console.log('Text response:', content.slice(0, 200));
      }
    } else {
      console.log('No image in response');
      console.log('Raw response:', JSON.stringify(result, null, 2).slice(0, 500));
    }
    
    // Show usage stats
    if (result.usage) {
      console.log(`\nTokens: ${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
