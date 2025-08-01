const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiStoryGenerator {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  async generateStory(prompt, genre, characterDNA, options = {}) {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds between retries
    const requestTimeout = 45000; // Increased to 45 seconds timeout for each attempt
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Generating story with Gemini (attempt ${attempt}/${maxRetries}) for genre: ${genre}`);
        console.log(`⏰ Setting ${requestTimeout/1000}s timeout for this attempt...`);
        
        const storyPrompt = this.buildStoryPrompt(prompt, genre, characterDNA, options);
        
        // Add timeout protection using Promise.race with longer timeout
        const generationPromise = this.model.generateContent(storyPrompt);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            console.log(`⏰ Gemini API request timed out after ${requestTimeout/1000} seconds on attempt ${attempt}`);
            reject(new Error(`Gemini API request timed out after ${requestTimeout/1000} seconds`));
          }, requestTimeout);
        });

        console.log(`🚀 Starting Gemini API call (attempt ${attempt})...`);
        const result = await Promise.race([generationPromise, timeoutPromise]);
        console.log(`✅ Gemini API call completed (attempt ${attempt})`);
        
        console.log(`📝 Processing response from Gemini...`);
        const response = await result.response;
        const storyText = response.text();
        console.log(`📝 Response received, length: ${storyText.length} characters`);
        console.log(`📝 First 200 chars: ${storyText.substring(0, 200)}...`);
        
        // Parse the story into scenes
        console.log(`🎭 Parsing story into scenes...`);

        // Add timeout protection for parsing using setTimeout
        let parsedStory;
        let parsingComplete = false;

        setTimeout(() => {
          if (!parsingComplete) {
            console.error(`❌ Story parsing timeout after 10 seconds - forcing completion`);
            throw new Error('Story parsing timeout after 10 seconds');
          }
        }, 10000);

        try {
          parsedStory = this.parseStoryIntoScenes(storyText, characterDNA);
          parsingComplete = true;
          console.log(`🎭 Parsing completed. Scenes found: ${parsedStory.scenes?.length || 0}`);
        } catch (parseError) {
          parsingComplete = true;
          console.error(`❌ Parsing error:`, parseError);

          // Create emergency fallback
          parsedStory = {
            title: `${characterDNA.name}'s Adventure`,
            scenes: [{
              id: 'scene_1',
              number: 1,
              title: 'The Adventure Begins',
              content: storyText.substring(0, Math.min(500, storyText.length)) + '...',
              description: storyText.substring(0, Math.min(500, storyText.length)) + '...',
              characterName: characterDNA.name,
              storyboardPrompt: `${characterDNA.name} begins an adventure, ${storyText.substring(0, 100)}`
            }],
            totalScenes: 1,
            character: characterDNA,
            emergencyFallback: true
          };
          console.log(`⚠️ Using emergency fallback story structure`);
        }
        
        console.log(`✅ Gemini story generation successful on attempt ${attempt}`);
        
        return {
          success: true,
          story: parsedStory,
          rawText: storyText,
          metadata: {
            genre,
            character: characterDNA.name,
            estimatedReadTime: Math.ceil(storyText.length / 1000),
            sceneCount: parsedStory.scenes.length,
            generatedBy: 'gemini-2.0-flash',
            attempt: attempt
          }
        };
      } catch (error) {
        console.error(`❌ Gemini attempt ${attempt} failed:`, error.message);
        
        // Check if this is a retryable error
        const isRetryable = this.isRetryableError(error);
        
        if (attempt === maxRetries || !isRetryable) {
          console.error(`❌ Gemini story generation failed after ${attempt} attempts, will use fallback`);
          throw new Error(`Story generation failed after ${attempt} attempts: ${error.message}`);
        }
        
        // Wait before retrying
        console.log(`⏳ Waiting ${retryDelay/1000}s before retry...`);
        await this.delay(retryDelay);
      }
    }
  }

  isRetryableError(error) {
    const retryableMessages = [
      'overloaded',
      'service unavailable', 
      '503',
      'temporarily unavailable',
      'rate limit',
      'quota exceeded',
      'timed out',
      'timeout'
    ];
    
    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkAvailability() {
    try {
      const timeoutDuration = 30000; // Increased to 30 seconds timeout for availability check
      
      console.log(`🔍 Checking Gemini availability with ${timeoutDuration/1000}s timeout...`);
      
      const testPromise = this.model.generateContent('Test');
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          console.log(`⏰ Gemini availability check timed out after ${timeoutDuration/1000}s`);
          reject(new Error('Gemini availability check timed out'));
        }, timeoutDuration);
      });

      const testResult = await Promise.race([testPromise, timeoutPromise]);
      console.log(`✅ Gemini availability check completed successfully`);
      
      return { 
        available: true, 
        model: 'gemini-2.0-flash',
        message: 'Gemini AI is available'
      };
    } catch (error) {
      console.log(`❌ Gemini availability check failed: ${error.message}`);
      return { 
        available: false, 
        model: 'gemini-2.0-flash',
        error: error.message,
        retryable: this.isRetryableError(error)
      };
    }
  }

  buildStoryPrompt(prompt, genre, characterDNA, options) {
    const characterName = characterDNA.name || 'the protagonist';
    const characterTraits = characterDNA.traits?.join(', ') || 'adventurous';
    const characterDescription = characterDNA.description || 'an adventurous character';
    
    // Extract additional options from frontend
    const tone = options.tone || 'lighthearted';
    const length = options.length || 'medium';
    const includeVoice = options.includeVoice !== false;
    const includeVideo = options.includeVideo !== false;
    
    // Add tone-specific guidance
    const toneGuidance = {
      lighthearted: 'Keep it fun and upbeat',
      serious: 'Make it thoughtful and meaningful', 
      humorous: 'Add comedy and funny moments',
      dramatic: 'Include emotional depth and tension',
      mysterious: 'Add suspense and intrigue',
      romantic: 'Include heartwarming moments'
    };
    
    // Add length-specific requirements
    const lengthGuidance = {
      short: 'Simple and focused story progression',
      medium: 'Well-developed story with clear progression', 
      long: 'Rich story with detailed character development'
    };
    
    return `You are a professional story creator. Create an engaging story with EXACTLY 4 scenes.

CHARACTER: ${characterName}
CHARACTER DESCRIPTION: ${characterDescription}
TRAITS: ${characterTraits}
STORY PROMPT: ${prompt}
GENRE: ${genre}
TONE: ${tone} - ${toneGuidance[tone] || 'Engaging and appropriate'}
LENGTH: ${length} - ${lengthGuidance[length] || 'Well-paced story'}
VOICE NARRATION: ${includeVoice ? 'Yes - Include narrative elements' : 'No - Focus on visual action only'}
VIDEO GENERATION: ${includeVideo ? 'Yes - Optimize for visual storytelling' : 'No - Text-focused'}

CRITICAL REQUIREMENT: Create EXACTLY 4 scenes - NO MORE, NO LESS

MANDATORY FORMAT - DO NOT DEVIATE:

SCENE 1: [Engaging scene title]
[2-3 sentences of engaging story content that readers will enjoy. Make it narrative, descriptive, and ${tone}. Focus on character emotions, dialogue, and story progression rather than just visual descriptions.]

SCENE 2: [Engaging scene title]
[2-3 sentences of engaging story content that readers will enjoy. Continue the narrative naturally from Scene 1. Include character development and ${tone} elements.]

SCENE 3: [Engaging scene title]
[2-3 sentences of engaging story content that readers will enjoy. Build tension or develop the plot further. Maintain the ${tone} throughout.]

SCENE 4: [Engaging scene title]
[2-3 sentences of engaging story content that readers will enjoy. Provide a satisfying conclusion that matches the ${tone} and resolves the story.]

REQUIREMENTS:
- EXACTLY 4 scenes only
- Each scene must start with "SCENE X:"
- Write 2-3 engaging sentences per scene that tell a story
- Focus on narrative, dialogue, emotions, and character development
- Match the ${tone} tone throughout
- Make it readable and enjoyable for humans
- Consider ${characterName}'s traits: ${characterTraits}
- Use the character description: ${characterDescription}
- Appropriate for ${genre} genre and ${length} length
- NO additional scenes beyond 4
${includeVoice ? '- Include narrative elements suitable for voice-over' : ''}
${includeVideo ? '- Ensure each scene is visually compelling for video' : ''}

EXAMPLE FOR ${tone.toUpperCase()} TONE:
SCENE 1: The Mysterious Discovery
${characterName} was exploring the old library when they noticed a strange glow coming from behind the dusty shelves. ${tone === 'humorous' ? 'With typical clumsiness, they knocked over three books while investigating.' : tone === 'dramatic' ? 'Their heart raced as they approached the mysterious light.' : tone === 'mysterious' ? 'An eerie silence filled the air as they cautiously moved closer.' : 'Curiosity sparked in their eyes as they investigated.'} What they found would change everything.

SCENE 2: The Secret Revealed
${tone === 'humorous' ? `${characterName} couldn't believe their eyes - and immediately tripped over their own feet in surprise.` : tone === 'dramatic' ? `${characterName}'s eyes widened in disbelief at what lay before them.` : tone === 'mysterious' ? `${characterName} carefully examined the discovery, sensing its importance.` : `${characterName} gasped as they realized what they had found.`} The ancient artifact hummed with energy, its surface covered in symbols they had never seen before. ${tone === 'humorous' ? 'They poked it experimentally, hoping it wouldn\'t explode.' : 'They knew this discovery would change their life forever.'}

SCENE 3: The Challenge Emerges
${tone === 'humorous' ? `Just as ${characterName} was getting comfortable with their find, everything went hilariously wrong.` : tone === 'dramatic' ? `Suddenly, ${characterName} realized the true weight of their discovery.` : tone === 'mysterious' ? `The artifact began to reveal its secrets, but at what cost?` : `${characterName} faced their first real test.`} The room began to shift and change around them, presenting challenges they never expected. ${tone === 'humorous' ? 'They wondered if they should have just stayed in bed today.' : 'This was only the beginning of their adventure.'}

SCENE 4: The Resolution
${tone === 'humorous' ? `Through a combination of luck and questionable decision-making, ${characterName} found their way forward.` : tone === 'dramatic' ? `With courage they didn't know they possessed, ${characterName} made their choice.` : tone === 'mysterious' ? `${characterName} embraced the mystery and stepped into the unknown.` : `${characterName} discovered the strength within themselves.`} The artifact's power had awakened something special in them, and they knew their ordinary life was now behind them. ${tone === 'humorous' ? 'They just hoped the next adventure would involve less falling down.' : 'This was just the beginning of their extraordinary journey.'}

NOW CREATE YOUR STORY WITH EXACTLY 4 SCENES FOLLOWING THIS EXACT FORMAT:`;
  }

  parseStoryIntoScenes(storyText, characterDNA) {
    console.log(`🔍 Starting scene parsing for text length: ${storyText.length}`);

    // Early validation
    if (!storyText || storyText.length < 50) {
      console.warn(`⚠️ Story text too short (${storyText.length} chars), using fallback`);
      return this.createEmergencyFallback(characterDNA, storyText);
    }

    console.log(`🔍 First 500 chars: ${storyText.substring(0, 500)}`);

    const scenes = [];
    
    try {
      // Primary parsing method: Simplified regex to avoid infinite loops
      console.log(`🔍 Starting primary regex execution...`);

      // Split by SCENE markers first, then process each part
      const sceneParts = storyText.split(/SCENE\s+\d+:/gi);
      console.log(`🔍 Split into ${sceneParts.length} parts by scene markers`);
      
      // Skip the first part if it's empty (before first scene)
      const startIndex = sceneParts[0].trim().length === 0 ? 1 : 0;

      for (let i = startIndex; i < sceneParts.length && scenes.length < 4; i++) {
        const part = sceneParts[i].trim();
        if (part.length === 0) continue;

        // Extract title and content
        const lines = part.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();

        if (title.length > 0 && content.length > 0) {
          const sceneNumber = scenes.length + 1;

          console.log(`✅ Parsed Scene ${sceneNumber}: "${title}" - Content length: ${content.length} chars`);

          scenes.push({
            id: `scene_${sceneNumber}`,
            number: sceneNumber,
            title: title,
            content: content,
            description: content,
            characterName: characterDNA.name,
            storyboardPrompt: this.generateStoryboardPrompt(title, content, characterDNA)
          });
        }
      }

      console.log(`🔍 Simple split method complete. Found ${scenes.length} scenes`);

      // Fallback parsing if primary method failed
      if (scenes.length === 0) {
        console.log(`⚠️ Primary parsing failed, trying fallback method...`);
        return this.fallbackParseStory(storyText, characterDNA);
      }

    } catch (error) {
      console.error(`❌ Error in primary parsing:`, error);
      console.log(`⚠️ Trying fallback parsing method...`);
      return this.fallbackParseStory(storyText, characterDNA);
    }

    console.log(`🎭 Story structure: ${scenes.length} scenes parsed with separate content and storyboard prompts`);

    // Ensure exactly 4 scenes
    if (scenes.length > 4) {
      console.log(`⚠️ Generated ${scenes.length} scenes, trimming to exactly 4`);
      scenes.splice(4); // Keep only first 4 scenes
    } else if (scenes.length < 4) {
      console.log(`⚠️ Only generated ${scenes.length} scenes, padding to exactly 4`);
      
      // Pad to exactly 4 scenes
      while (scenes.length < 4) {
        const sceneNum = scenes.length + 1;
        const fallbackContent = `${characterDNA.name} continues their adventure with determination and courage.`;
        scenes.push({
          id: `scene_${sceneNum}`,
          number: sceneNum,
          title: `Scene ${sceneNum}`,
          content: fallbackContent,
          characterName: characterDNA.name,
          storyboardPrompt: this.generateStoryboardPrompt(`Scene ${sceneNum}`, fallbackContent, characterDNA)
        });
      }
    }

    console.log(`✅ Final story structure: ${scenes.length} scenes with readable content + storyboard prompts`);

    return {
      title: `${characterDNA.name}'s Adventure`,
      scenes,
      totalScenes: 4, // Always 4 now
      character: characterDNA
    };
  }

  fallbackParseStory(storyText, characterDNA) {
    console.log(`🔧 Using fallback parsing method...`);

    const scenes = [];

    // Try simpler scene splitting
    const lines = storyText.split('\n').filter(line => line.trim().length > 0);

    let currentScene = null;
    let sceneCount = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Check for scene headers (more flexible)
      if (trimmedLine.match(/^SCENE\s+\d+/i) || trimmedLine.match(/^Scene\s+\d+/i)) {
        // Save previous scene if exists
        if (currentScene && currentScene.content.trim().length > 0) {
          scenes.push(currentScene);
        }

        sceneCount++;
        const title = trimmedLine.replace(/^SCENE\s+\d+:\s*/i, '').replace(/^Scene\s+\d+:\s*/i, '') || `Scene ${sceneCount}`;

        currentScene = {
          id: `scene_${sceneCount}`,
          number: sceneCount,
          title: title,
          content: '',
          description: '',
          characterName: characterDNA.name,
          storyboardPrompt: ''
        };

        console.log(`🔧 Fallback found scene ${sceneCount}: "${title}"`);
      } else if (currentScene && trimmedLine.length > 0) {
        // Add content to current scene
        currentScene.content += (currentScene.content ? ' ' : '') + trimmedLine;
      }
    }

    // Add the last scene
    if (currentScene && currentScene.content.trim().length > 0) {
      scenes.push(currentScene);
    }

    // If still no scenes, create basic fallback scenes
    if (scenes.length === 0) {
      console.log(`⚠️ No scenes found, creating basic fallback scenes from full text...`);

      // Split text into roughly equal parts
      const textChunks = this.splitTextIntoChunks(storyText, 4);

      for (let i = 0; i < textChunks.length; i++) {
        scenes.push({
          id: `scene_${i + 1}`,
          number: i + 1,
          title: `Scene ${i + 1}`,
          content: textChunks[i],
          description: textChunks[i],
          characterName: characterDNA.name,
          storyboardPrompt: this.generateStoryboardPrompt(`Scene ${i + 1}`, textChunks[i], characterDNA)
        });
      }
    }

    // Update storyboard prompts and descriptions for parsed scenes
    scenes.forEach(scene => {
      scene.description = scene.content;
      scene.storyboardPrompt = this.generateStoryboardPrompt(scene.title, scene.content, characterDNA);
    });

    console.log(`✅ Fallback parsing completed. Found ${scenes.length} scenes`);

    return {
      title: `${characterDNA.name}'s Adventure`,
      scenes: scenes.slice(0, 4), // Ensure max 4 scenes
      totalScenes: Math.min(scenes.length, 4),
      character: characterDNA,
      fallbackParsed: true
    };
  }

  splitTextIntoChunks(text, numChunks) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunkSize = Math.ceil(sentences.length / numChunks);
    const chunks = [];

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, sentences.length);
      const chunk = sentences.slice(start, end).join('. ').trim();
      if (chunk.length > 0) {
        chunks.push(chunk + '.');
      }
    }

    return chunks;
  }

  createEmergencyFallback(characterDNA, storyText = '') {
    console.log(`🚨 Creating emergency fallback story for ${characterDNA.name}`);

    const fallbackContent = storyText || `${characterDNA.name} embarks on an exciting adventure filled with challenges and discoveries.`;

    return {
      title: `${characterDNA.name}'s Adventure`,
      scenes: [{
        id: 'scene_1',
        number: 1,
        title: 'The Adventure Begins',
        content: fallbackContent,
        description: fallbackContent,
        characterName: characterDNA.name,
        storyboardPrompt: `${characterDNA.name} begins an exciting adventure`
      }],
      totalScenes: 1,
      character: characterDNA,
      emergencyFallback: true
    };
  }

  generateStoryboardPrompt(sceneTitle, sceneContent, characterDNA) {
    // Extract key visual elements from the story content for storyboard generation
    const characterName = characterDNA.name || 'character';
    const characterTraits = characterDNA.traits?.slice(0, 2)?.join(', ') || 'adventurous';
    
    // Extract action words and visual elements from the story content
    const contentWords = sceneContent.toLowerCase();
    let setting = 'indoor scene';
    let action = 'standing';
    let mood = 'neutral';
    
    // Analyze content for setting
    if (contentWords.includes('library') || contentWords.includes('book')) setting = 'ancient library with books and shelves';
    else if (contentWords.includes('forest') || contentWords.includes('tree')) setting = 'mystical forest';
    else if (contentWords.includes('cave') || contentWords.includes('underground')) setting = 'mysterious cave';
    else if (contentWords.includes('castle') || contentWords.includes('tower')) setting = 'medieval castle';
    else if (contentWords.includes('city') || contentWords.includes('street')) setting = 'bustling city street';
    else if (contentWords.includes('mountain') || contentWords.includes('peak')) setting = 'mountain landscape';
    else if (contentWords.includes('ocean') || contentWords.includes('sea')) setting = 'coastal scene with ocean';
    
    // Analyze content for action
    if (contentWords.includes('running') || contentWords.includes('chase')) action = 'running or chasing';
    else if (contentWords.includes('fighting') || contentWords.includes('battle')) action = 'in combat stance';
    else if (contentWords.includes('searching') || contentWords.includes('looking')) action = 'searching and investigating';
    else if (contentWords.includes('climbing') || contentWords.includes('ascending')) action = 'climbing';
    else if (contentWords.includes('flying') || contentWords.includes('soaring')) action = 'flying through the air';
    else if (contentWords.includes('discovering') || contentWords.includes('found')) action = 'making a discovery';
    else if (contentWords.includes('hiding') || contentWords.includes('sneaking')) action = 'hiding or sneaking';
    
    // Analyze content for mood
    if (contentWords.includes('scared') || contentWords.includes('afraid') || contentWords.includes('terrified')) mood = 'scared or worried';
    else if (contentWords.includes('happy') || contentWords.includes('excited') || contentWords.includes('joy')) mood = 'happy and excited';
    else if (contentWords.includes('angry') || contentWords.includes('furious') || contentWords.includes('mad')) mood = 'angry or determined';
    else if (contentWords.includes('surprised') || contentWords.includes('shocked') || contentWords.includes('amazed')) mood = 'surprised and amazed';
    else if (contentWords.includes('sad') || contentWords.includes('crying') || contentWords.includes('upset')) mood = 'sad or emotional';
    else if (contentWords.includes('curious') || contentWords.includes('wonder') || contentWords.includes('investigate')) mood = 'curious and focused';
    
    const prompt = `Create a detailed storyboard panel for: ${sceneTitle}
    
    Main character: ${characterName} (${characterTraits})
    Setting: ${setting}
    Action: ${characterName} is ${action}
    Mood/Expression: ${mood}
    
    Visual style: Clean storyboard illustration, cinematic composition, clear character poses, detailed background elements, professional animation reference quality. Character should be the main focus with supporting environmental details.
    
    Camera angle: Medium shot showing character and environment
    Lighting: Dramatic and appropriate for the scene mood
    
    Based on story content: ${sceneContent.substring(0, 150)}...`;
    
    return prompt;
  }

  async generateStoryboard(scene, style = 'cartoon') {
    try {
      console.log(`Generating storyboard for scene: ${scene.title}`);
      
      const storyboardPrompt = `Create a detailed storyboard image for this scene:
      
      Title: ${scene.title}
      Character: ${scene.characterName}
      
      Description: ${scene.content.substring(0, 300)}
      
      Style: ${style} storyboard illustration, clear composition, good for animation reference
      
      Requirements:
      - Show the key moment of the scene
      - Include the character prominently
      - Clear visual storytelling
      - Professional storyboard quality
      - ${style} art style`;
      
      // This would integrate with Stable Diffusion
      return {
        prompt: storyboardPrompt,
        sceneId: scene.id,
        imageUrl: null // To be filled by Stable Diffusion service
      };
    } catch (error) {
      console.error('Storyboard generation error:', error);
      throw error;
    }
  }
}

module.exports = { GeminiStoryGenerator };
