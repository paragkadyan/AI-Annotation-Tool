import * as assert from 'assert';
import * as myExtension from '../extension'; 
import * as vscode from 'vscode';

suite('Extension Logic Coverage Test', () => {

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
    assert.ok(updatedText.includes("EditedBy: DING"), `Expected 'EditedBy: JACK' in: ${updatedText}`);
    
    // Check for the date (just check for the year to be safe against day/month format flips)
    assert.ok(updatedText.includes("2026"), "The header should contain the current year (2026)");

    const startCount = (updatedText.match(/AI_START/g) || []).length;
    assert.strictEqual(startCount, 1, "Should have modified the existing header, not added a new one");
});

});
