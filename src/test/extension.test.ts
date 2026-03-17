import * as assert from 'assert';
import * as myExtension from '../extension'; 
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Extension Logic Coverage Test', () => {
    
    test('Scenario 1: Create new file if not exists', async function (){
        this.timeout(10000); // Increase timeout for file operations
        console.log('DEBUG: Current folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			assert.fail('Test requires an open workspace folder.');
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		const githubPath = path.join(rootPath, '.github');
		const filePath = path.join(githubPath, 'copilot-instructions.md');

		// Cleanup before test
		if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
        await new Promise(resolve => setTimeout(resolve, 800));

		// Trigger command (assuming it's registered as ai-annotator.initFile)
		await vscode.commands.executeCommand('ai-annotator.initFile');

		// Wait briefly for file system
		await new Promise(resolve => setTimeout(resolve, 500));

		assert.strictEqual(fs.existsSync(filePath), true, 'File should be created');
		const content = fs.readFileSync(filePath, 'utf8');
		assert.ok(content.includes('###AI_GEN_START###'), 'Should contain the start marker');
	});

    test('Scenario 2: Append instructions to existing file', async function () {
    this.timeout(10000);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders![0].uri.fsPath;
    const githubPath = path.join(rootPath, '.github');
    const filePath = path.join(githubPath, 'copilot-instructions.md');

    // 1. FORCE CLEANUP: Remove whatever Scenario 1 left behind
    if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }

    // 2. DIRTY SETUP: Create a file WITHOUT markers
    if (!fs.existsSync(githubPath)) { fs.mkdirSync(githubPath, { recursive: true }); }
    const userText = "# Existing Project Rules\nDo not overwrite me.";
    fs.writeFileSync(filePath, userText, 'utf8');

    // 3. ACT: Trigger the command
    await vscode.commands.executeCommand('ai-annotator.initFile');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. ASSERT: Check that it merged instead of skipping or overwriting
    const finalContent = fs.readFileSync(filePath, 'utf8');
    assert.ok(finalContent.includes(userText), 'User text was deleted!');
    assert.ok(finalContent.includes('###AI_GEN_START###'), 'AI markers were not added');
});


    test('Regex Test: Should detect the AI Handshake', () => {
        const sampleText = "Random Code... ### AI_GEN_START ### ...More Code";
        
        // --- FIX HERE: Use the one from your ACTUAL extension file ---
        const found = myExtension.startRegex.test(sampleText); 
        
        assert.strictEqual(found, true, "The REAL Regex in extension.ts should have been triggered!");
    });

    test('Logic Test: Should trigger getContext', () => {
        // --- FIX HERE: Call the actual function you exported ---
        const result = myExtension.getContext({ languageId: 'python' });
        
        assert.strictEqual(result.s, '#', "This will turn the getContext function GREEN!");
    });

	test('Integration Test: applyAnnotation should replace Chat Markers', async () => {
    // 1. Create a "Fake" document in memory
    const content = "###AI_GEN_START###\nprint('hello')\n###AI_GEN_END###";
    const document = await vscode.workspace.openTextDocument({
        content: content,
        language: 'python'
    });

    // 2. Call the REAL function
    // We pass a dummy range since Path 1 (Chat) scans the whole file anyway
    const dummyRange = new vscode.Range(0, 0, 0, 0);
    await myExtension.applyAnnotation(document, dummyRange, content);

    // 3. Wait a moment for the edit to apply (VS Code edits are async)
    await new Promise(resolve => setTimeout(resolve, 500));

    const newText = document.getText();

    // 4. Assertions: This turns the Chat Scanner logic GREEN
    assert.ok(newText.includes(">>> AI_START"), "Header was not inserted!");
    assert.ok(newText.includes("<<< AI_END"), "Footer was not inserted!");
    assert.strictEqual(newText.includes("###AI_GEN"), false, "Markers were not removed!");
	});

	test('Edge Case: Should NOT update header if typing AFTER the footer', async () => {
    const content = "// >>> AI_START | ID: JACK | 01-01-2026\ncode\n// <<< AI_END\n";
    const document = await vscode.workspace.openTextDocument({ content, language: 'python' });

    // Simulate typing on the line AFTER the AI_END
    const lineAfterFooter = new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 0));
    const typedText = "This is new human code outside the AI zone.";

    // @ts-ignore
    myExtension.isProcessing = false;
    await myExtension.applyAnnotation(document, lineAfterFooter, typedText);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Assertion: There should now be TWO starts, because we started a new block
    const startCount = (document.getText().match(/AI_START/g) || []).length;
    assert.strictEqual(startCount, 2, "It should have started a new block, not updated the old one!");
	});

    test('Logic Test: Self-Recognition should ignore its own headers', () => {
    // 1. Create a "Fake" event
    const fakeEvent: any = {
        document: vscode.window.activeTextEditor?.document,
        contentChanges: [{
            text: ">>> AI_START | ID: JACK", // The extension's own output
            range: new vscode.Range(0,0,0,0)
        }]
    };

    // 2. Call the handler
    myExtension.handleTextChange(fakeEvent);

    // 3. Assertion: Since it's self-recognition, the debounceTimer should NOT be set
    // You can check if isProcessing is still false
    assert.strictEqual(myExtension.isProcessing, false, "Should not start processing for its own tags");    
});

    test('Trigger Logic: Should enter the Debounce block when markers exist', async () => {
    // 1. Open the document
    const document = await vscode.workspace.openTextDocument({
        content: "Some existing code... ###AI_GEN_START###",
        language: 'python'
    });

    // 2. IMPORTANT: Actually show the document in the editor!
    await vscode.window.showTextDocument(document);

    // 3. Mock the Event object
    const fakeEvent: any = {
        document: document,
        contentChanges: [{
            text: "p", 
            range: new vscode.Range(0, 0, 0, 0)
        }]
    };

    // 4. Reset states
    // @ts-ignore
    myExtension.isProcessing = false;

    // 5. Call the handler
    myExtension.handleTextChange(fakeEvent);

    // 6. Wait for the 1200ms debounce + a small buffer
    await new Promise(resolve => setTimeout(resolve, 1800));

    // 7. Assertion
    const text = document.getText();
    assert.ok(text.includes("AI_START"), "Failed to trigger annotation via Markers!");
    });

    test('Complex Case: Should update existing header with EditedBy tag', async () => {
    const initialText = "# >>> AI_START | ID: JACK | 01-01-2024\nprint('old code')\n# <<< AI_END";
    const document = await vscode.workspace.openTextDocument({
        content: initialText,
        language: 'python'
    });

    await vscode.window.showTextDocument(document);

    const middleLineRange = new vscode.Range(1, 0, 1, 0);
    const humanInput = "This is a long line of code typed by a human to trigger Path 2.";

    // Reset lock
    // @ts-ignore
    myExtension.isProcessing = false;

    await myExtension.applyAnnotation(document, middleLineRange, humanInput);

    // Wait for the async workspace edit
    await new Promise(resolve => setTimeout(resolve, 1200));

    const updatedText = document.getText();
    
    // --- DEBUG: See what is actually happening ---
    //console.log("DEBUG UPDATED TEXT:", updatedText);

    // Check for the "EditedBy" keyword first
    assert.ok(updatedText.includes("EditedBy: 123"), `Expected 'EditedBy: 123' in: ${updatedText}`);
    
    // Check for the date (just check for the year to be safe against day/month format flips)
    assert.ok(updatedText.includes("2026"), "The header should contain the current year (2026)");

    const startCount = (updatedText.match(/AI_START/g) || []).length;
    assert.strictEqual(startCount, 1, "Should have modified the existing header, not added a new one");
});

    test('Metadata Transition: Should convert ###AI_EDITED back to >>> AI_START', async function () {
    this.timeout(10000);

    // 1. SETUP: Input block with ###AI_EDITED and existing history
    const initialText = `###AI_EDITED | DATA: ID: 111 | 01-01-2026 | EditedBy: 222 (02-01-2026)###
function processData() {
    console.log("Current editor is 333");
    return true;
}
// >>> AI_END`;

    const document = await vscode.workspace.openTextDocument({
        content: initialText,
        language: 'javascript'
    });
    await vscode.window.showTextDocument(document);

    // Identify the range where the "Human" is editing (the console.log line)
    const editRange = new vscode.Range(2, 4, 2, 40);
    const humanInput = '    console.log("Updated by 333");';

    // Reset the extension's internal lock
    // @ts-ignore
    myExtension.isProcessing = false;

    // 2. ACT: Apply the annotation
    await myExtension.applyAnnotation(document, editRange, humanInput);

    // 3. WAIT: Workspace edits are asynchronous
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 4. ASSERT
    const updatedText = document.getText();
    const lines = updatedText.split('\n');
    
    //console.log("DEBUG TRANSITION TEXT:", updatedText);

    // Verify the Header Change
    // Expecting: >>> AI_START | ID: 111 | 01-01-2026 | EditedBy: 222 (02-01-2026), 333 (16-03-2026)
    assert.ok(lines[0].startsWith("// >>> AI_START"), `Header should start with >>> AI_START. Found: ${lines[0]}`);
    
    // Verify History Preservation
    assert.ok(lines[0].includes("ID: 111"), "Original ID 111 was lost");
    assert.ok(lines[0].includes("222 (02-01-2026)"), "Previous editor 222 was lost");
    
    // Verify New Editor Append (assuming current user is 333)
    assert.ok(lines[0].includes("123"), "New editor 123 was not added to the chain");

    // Verify the Closing Marker and Code
    assert.ok(updatedText.includes(">>> AI_END"), "The closing marker >>> AI_END was lost");
});

test('Tab suggestion: Should trigger text change logic when accepting a tab suggestion', async() => {
        

        const document = await vscode.workspace.openTextDocument({
                 content: `def fun()
                    print("This function is used as test case")`,
                language: 'python'
         });


       

        const fakeEvent: any = {
        document: document,
        contentChanges: [{
            text: `def fun()
                    print("This function is used as test case")`,
            range: new vscode.Range(0,0,0,0)
        }]
        };

        await vscode.window.showTextDocument(document);

        // @ts-ignore
        myExtension.isProcessing = false;


        myExtension.handleTextChange(fakeEvent);

        await new Promise(resolve => setTimeout(resolve, 1800));


        const text = document.getText();
        assert.ok(text.includes("AI_START"), "Failed to trigger annotation via Markers!");
});

});

    

