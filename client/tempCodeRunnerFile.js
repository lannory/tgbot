let nums = [0,1,0,3,12];
let zeroCount = 0;

nums = nums.filter(item => {
	if(item === 0){
		zeroCount++;
	}
	return item !==0
})

for(let i = 0; i < zeroCount; i++){
	nums.push(0)
}

console.log(nums)